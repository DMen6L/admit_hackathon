from uuid import uuid4

import pytest

from admit_hackathon.api.multiplayer.engine import (
    CastRejected, Match, SHIELD, SPELLS, TIME_LOCK, TIME_LOCK_DELAY_MS, WINDUP_MS,
)


def match() -> Match:
    game = Match()
    game.add_player(uuid4(), "one")
    game.add_player(uuid4(), "two")
    game.start()
    return game


def test_warning_precedes_impact_and_one_hit_shield_blocks_it() -> None:
    game = match()
    game.cast(0, "rune.triangle", 1000)
    attack = game.attacks[0]
    assert attack.release_at_ms == 1000 + WINDUP_MS
    assert attack.impact_at_ms == attack.release_at_ms + 800
    game.cast(1, SHIELD, 1000)
    assert not game.advance(attack.impact_at_ms - 1)
    assert game.advance(attack.impact_at_ms)
    assert game.players[1].health == 100
    assert game.players[1].shield_until_ms == 0
    game.advance(attack.impact_at_ms + 100)
    assert game.players[1].health == 100


def test_defensive_shield_bypasses_recent_offense_but_has_own_cooldown() -> None:
    game = match()
    game.cast(1, "rune.lightning", 1000)
    game.cast(0, "rune.triangle", 1100)
    game.cast(0, SHIELD, 1200)
    with pytest.raises(CastRejected, match="cooldown"):
        game.cast(0, SHIELD, 1300)
    game.advance(4500)
    assert game.players[0].health == 100


def test_invalid_and_early_repeated_commands_cannot_damage() -> None:
    game = match()
    with pytest.raises(CastRejected, match="invalid_spell"):
        game.cast(0, "unknown", 0)
    game.cast(0, "rune.triangle", 0)
    with pytest.raises(CastRejected, match="cooldown"):
        game.cast(0, "rune.lightning", 1000)
    assert game.players[1].health == 100
    game.advance(3800)
    assert game.players[1].health == 80


def test_match_end_and_forfeit_are_authoritative() -> None:
    game = match()
    for start in (0, 5000, 10000, 15000, 20000):
        game.cast(0, "rune.triangle", start)
        game.advance(start + 3800)
    assert game.phase == "finished"
    assert game.winner == 0
    with pytest.raises(CastRejected, match="not_ready"):
        game.cast(1, SHIELD, 25000)
    another = match()
    another.forfeit(0)
    assert another.phase == "finished"
    assert another.winner == 1


@pytest.mark.parametrize("spell_id,damage,travel_ms", [
    ("rune.triangle", 20, 800), ("rune.lightning", 15, 500),
    ("rune.hourglass", 45, 1000), ("rune.line", 7, 200),
])
def test_every_attack_spell_has_server_side_damage_and_warning(spell_id: str, damage: int, travel_ms: int) -> None:
    game = match()
    game.cast(0, spell_id, 1000)
    attack = game.attacks[0]
    expected_windup = WINDUP_MS + (TIME_LOCK_DELAY_MS if spell_id == "rune.hourglass" else 0)
    assert attack.release_at_ms - attack.started_at_ms == expected_windup
    assert attack.impact_at_ms - attack.release_at_ms == travel_ms
    assert game.snapshot(1000)["casts"][-1]["spellId"] == spell_id
    game.advance(attack.impact_at_ms)
    assert game.players[1].health == 100 - damage
    assert set(SPELLS) == {"rune.triangle", "rune.lightning", "rune.hourglass", "rune.line"}


def test_time_lock_delays_current_or_next_attack_and_is_a_confirmed_cast() -> None:
    game = match()
    game.cast(0, "rune.triangle", 1000)
    original_impact = game.attacks[0].impact_at_ms
    game.cast(1, TIME_LOCK, 1500)
    assert game.attacks[0].slowed is True
    assert game.attacks[0].impact_at_ms == original_impact + TIME_LOCK_DELAY_MS
    assert game.snapshot(1500)["casts"][-1]["spellId"] == TIME_LOCK
    game.advance(original_impact)
    assert game.players[1].health == 100
    game.advance(original_impact + TIME_LOCK_DELAY_MS)
    assert game.players[1].health == 80

    another = match()
    another.cast(0, TIME_LOCK, 1000)
    assert another.players[1].slow_next_attack is True
    another.cast(1, "rune.line", 2000)
    assert another.attacks[0].release_at_ms - 2000 == WINDUP_MS + TIME_LOCK_DELAY_MS
    assert another.players[1].slow_next_attack is False
