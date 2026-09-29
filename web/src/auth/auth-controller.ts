import {
  AuthRequestError,
  InvalidCredentialsError,
  type AuthService,
  type AuthUser,
  type SignInCredentials,
} from './auth-service';
import { validateCredentials } from './credentials';

interface AuthControllerOptions {
  onSignOut: () => void;
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

export class AuthController {
  private readonly loginScreen = requiredElement<HTMLElement>('#login-screen');
  private readonly gameScreen = requiredElement<HTMLElement>('#game-screen');
  private readonly form = requiredElement<HTMLFormElement>('#login-form');
  private readonly login = requiredElement<HTMLInputElement>('#login');
  private readonly password = requiredElement<HTMLInputElement>('#password');
  private readonly keepSignedIn = requiredElement<HTMLInputElement>('#keep-signed-in');
  private readonly loginError = requiredElement<HTMLElement>('#login-field-error');
  private readonly passwordError = requiredElement<HTMLElement>('#password-error');
  private readonly formError = requiredElement<HTMLElement>('#login-error');
  private readonly submitButton = requiredElement<HTMLButtonElement>('#login-submit');
  private readonly passwordToggle = requiredElement<HTMLButtonElement>('#password-toggle');
  private readonly currentUser = requiredElement<HTMLElement>('#current-user');
  private readonly signOutButton = requiredElement<HTMLButtonElement>('#sign-out');
  private readonly headingEyebrow = requiredElement<HTMLElement>('#auth-eyebrow');
  private readonly heading = requiredElement<HTMLElement>('#login-title');
  private readonly headingCopy = requiredElement<HTMLElement>('#login-copy');
  private readonly modeToggle = requiredElement<HTMLButtonElement>('#auth-mode-toggle');
  private readonly demoAccess = requiredElement<HTMLElement>('#demo-access');
  private registering = false;

  constructor(
    private readonly authService: AuthService,
    private readonly options: AuthControllerOptions,
  ) {}

  async initialize(): Promise<void> {
    this.form.addEventListener('submit', (event) => { void this.handleSubmit(event); });
    this.passwordToggle.addEventListener('click', () => this.togglePasswordVisibility());
    this.modeToggle.addEventListener('click', () => this.toggleMode());
    this.signOutButton.addEventListener('click', () => { void this.handleSignOut(); });
    this.login.addEventListener('input', () => this.setFieldError(this.login, this.loginError));
    this.password.addEventListener('input', () => this.setFieldError(this.password, this.passwordError));

    const user = await this.authService.restoreSession();
    if (user) this.showGame(user);
    else this.showLogin();
  }

  private async handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    this.clearErrors();

    const credentials: SignInCredentials = {
      login: this.login.value,
      password: this.password.value,
      keepSignedIn: this.keepSignedIn.checked,
    };
    const errors = validateCredentials(credentials);
    this.setFieldError(this.login, this.loginError, errors.login);
    this.setFieldError(this.password, this.passwordError, errors.password);
    if (errors.login || errors.password) {
      (errors.login ? this.login : this.password).focus();
      return;
    }

    this.setPending(true);
    try {
      const user = this.registering
        ? await this.authService.register(credentials)
        : await this.authService.signIn(credentials);
      this.form.reset();
      this.showGame(user);
    } catch (error) {
      this.formError.textContent = error instanceof InvalidCredentialsError || error instanceof AuthRequestError
        ? error.message
        : this.registering
          ? 'Account creation is temporarily unavailable. Please try again.'
          : 'Sign-in is temporarily unavailable. Please try again.';
      this.formError.hidden = false;
      this.password.select();
    } finally {
      this.setPending(false);
    }
  }

  private async handleSignOut(): Promise<void> {
    this.signOutButton.disabled = true;
    try {
      await this.authService.signOut();
      this.options.onSignOut();
      this.showLogin();
    } finally {
      this.signOutButton.disabled = false;
    }
  }

  private showGame(user: AuthUser): void {
    this.currentUser.textContent = user.login;
    this.loginScreen.hidden = true;
    this.gameScreen.hidden = false;
  }

  private showLogin(): void {
    this.gameScreen.hidden = true;
    this.loginScreen.hidden = false;
    this.password.value = '';
    this.login.focus();
  }

  private togglePasswordVisibility(): void {
    const show = this.password.type === 'password';
    this.password.type = show ? 'text' : 'password';
    this.passwordToggle.textContent = show ? 'Hide' : 'Show';
    this.passwordToggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    this.passwordToggle.setAttribute('aria-pressed', String(show));
    this.password.focus();
  }

  private setPending(pending: boolean): void {
    this.submitButton.disabled = pending;
    this.submitButton.textContent = pending
      ? (this.registering ? 'Creating your account…' : 'Entering the arena…')
      : (this.registering ? 'Create account' : 'Enter the arena');
    this.form.setAttribute('aria-busy', String(pending));
  }

  private clearErrors(): void {
    this.setFieldError(this.login, this.loginError);
    this.setFieldError(this.password, this.passwordError);
    this.formError.hidden = true;
    this.formError.textContent = '';
  }

  private toggleMode(): void {
    this.registering = !this.registering;
    this.clearErrors();
    this.headingEyebrow.textContent = this.registering ? 'New spellcaster' : 'Welcome back';
    this.heading.textContent = this.registering ? 'Create your account' : 'Enter the arena';
    this.headingCopy.textContent = this.registering
      ? 'Choose a login to begin your spellbook.'
      : 'Sign in to continue to your spellbook.';
    this.submitButton.textContent = this.registering ? 'Create account' : 'Enter the arena';
    this.modeToggle.textContent = this.registering ? 'Already have an account? Sign in' : 'Create an account';
    this.demoAccess.hidden = this.registering;
    this.login.focus();
  }

  private setFieldError(input: HTMLInputElement, output: HTMLElement, message?: string): void {
    input.setAttribute('aria-invalid', String(Boolean(message)));
    output.textContent = message ?? '';
  }
}
