"""Pure, clock-injected rules shared by every connected player in a room."""

from dataclasses import dataclass, field
from uuid import UUID

HEALTH = 100
COOLDOWN_MS = 900
WINDUP_MS = 3000
SHIELD_MS = 4300
SPELLS = {
    "rune.triangle": (20, 800),
    "rune.lightning": (15, 500),
}
SHIELD = "rune.circle"


class CastRejected(ValueError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass
class Fighter:
    user_id: UUID
    login: str
    health: int = HEALTH
    cast_at_ms: int = -10_000_000_000_000
    shield_at_ms: int = -10_000_000_000_000
    shield_until_ms: int = 0


@dataclass
class Attack:
    seat: int
    spell_id: str
    started_at_ms: int
    release_at_ms: int
    impact_at_ms: int


@dataclass
class Impact:
    seat: int
    spell_id: str
    at_ms: int
    blocked: bool


@dataclass
class Match:
    players: list[Fighter] = field(default_factory=list)
    phase: str = "waiting"
    revision: int = 0
    attacks: list[Attack] = field(default_factory=list)
    impacts: list[Impact] = field(default_factory=list)
    winner: int | None = None

    def add_player(self, user_id: UUID, login: str) -> int:
        if any(player.user_id == user_id for player in self.players):
            raise CastRejected("already_joined")
        if len(self.players) >= 2:
            raise CastRejected("room_full")
        self.players.append(Fighter(user_id=user_id, login=login))
        self.revision += 1
        return len(self.players) - 1

    def start(self) -> None:
        if len(self.players) == 2 and self.phase == "waiting":
            self.phase = "active"
            self.revision += 1

    def cast(self, seat: int, spell_id: str, now_ms: int) -> None:
        self.advance(now_ms)
        if self.phase != "active" or seat not in (0, 1):
            raise CastRejected("not_ready")
        if spell_id not in SPELLS and spell_id != SHIELD:
            raise CastRejected("invalid_spell")
        player = self.players[seat]
        incoming = any(attack.seat != seat and attack.impact_at_ms > now_ms for attack in self.attacks)
        if spell_id == SHIELD:
            if now_ms - player.shield_at_ms < COOLDOWN_MS or (not incoming and now_ms - player.cast_at_ms < COOLDOWN_MS):
                raise CastRejected("cooldown")
            player.shield_at_ms = now_ms
            player.shield_until_ms = now_ms + SHIELD_MS
        else:
            if now_ms - player.cast_at_ms < COOLDOWN_MS or any(
                attack.seat == seat and attack.impact_at_ms > now_ms for attack in self.attacks
            ):
                raise CastRejected("cooldown")
            _, travel_ms = SPELLS[spell_id]
            self.attacks.append(Attack(seat, spell_id, now_ms, now_ms + WINDUP_MS, now_ms + WINDUP_MS + travel_ms))
        player.cast_at_ms = now_ms
        self.revision += 1

    def advance(self, now_ms: int) -> bool:
        before = self.revision
        self.impacts = [impact for impact in self.impacts if now_ms - impact.at_ms < 700]
        arrived = sorted((attack for attack in self.attacks if attack.impact_at_ms <= now_ms),
                         key=lambda attack: (attack.impact_at_ms, attack.seat))
        self.attacks = [attack for attack in self.attacks if attack.impact_at_ms > now_ms]
        if self.phase != "active":
            return False
        for attack in arrived:
            target = 1 - attack.seat
            defender = self.players[target]
            blocked = defender.shield_until_ms > attack.impact_at_ms
            if blocked:
                defender.shield_until_ms = 0
            else:
                defender.health = max(0, defender.health - SPELLS[attack.spell_id][0])
            self.impacts.append(Impact(target, attack.spell_id, attack.impact_at_ms, blocked))
            self.revision += 1
        if any(player.health == 0 for player in self.players):
            self.phase = "finished"
            surviving = [seat for seat, player in enumerate(self.players) if player.health > 0]
            self.winner = surviving[0] if len(surviving) == 1 else None
            self.attacks.clear()
            self.revision += 1
        return self.revision != before

    def forfeit(self, seat: int) -> None:
        if self.phase == "active":
            self.phase = "finished"
            self.winner = 1 - seat
            self.attacks.clear()
            self.revision += 1

    def snapshot(self, now_ms: int) -> dict:
        return {
            "type": "state", "v": 1, "revision": self.revision, "serverTimeMs": now_ms,
            "phase": self.phase,
            "players": [
                {"seat": seat, "login": player.login, "health": player.health,
                 "castReadyAtMs": player.cast_at_ms + COOLDOWN_MS,
                 "shieldReadyAtMs": player.shield_at_ms + COOLDOWN_MS,
                 "shieldUntilMs": player.shield_until_ms}
                for seat, player in enumerate(self.players)
            ],
            "attacks": [
                {"seat": attack.seat, "spellId": attack.spell_id,
                 "startedAtMs": attack.started_at_ms, "releaseAtMs": attack.release_at_ms,
                 "impactAtMs": attack.impact_at_ms}
                for attack in self.attacks
            ],
            "impacts": [
                {"seat": impact.seat, "spellId": impact.spell_id,
                 "atMs": impact.at_ms, "blocked": impact.blocked}
                for impact in self.impacts
            ],
            "winner": self.winner,
        }
