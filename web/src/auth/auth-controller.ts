import {
  InvalidCredentialsError,
  type AuthService,
  type SignInCredentials,
} from './auth-service';
import { validateCredentials } from './credentials';

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

export class AuthController {
  private readonly loginScreen = requiredElement<HTMLElement>('#login-screen');
  private readonly form = requiredElement<HTMLFormElement>('#login-form');
  private readonly email = requiredElement<HTMLInputElement>('#email');
  private readonly password = requiredElement<HTMLInputElement>('#password');
  private readonly keepSignedIn = requiredElement<HTMLInputElement>('#keep-signed-in');
  private readonly emailError = requiredElement<HTMLElement>('#email-error');
  private readonly passwordError = requiredElement<HTMLElement>('#password-error');
  private readonly formError = requiredElement<HTMLElement>('#login-error');
  private readonly submitButton = requiredElement<HTMLButtonElement>('#login-submit');
  private readonly passwordToggle = requiredElement<HTMLButtonElement>('#password-toggle');

  constructor(
    private readonly authService: AuthService,
  ) {}

  async initialize(): Promise<void> {
    this.form.addEventListener('submit', (event) => { void this.handleSubmit(event); });
    this.passwordToggle.addEventListener('click', () => this.togglePasswordVisibility());
    this.email.addEventListener('input', () => this.setFieldError(this.email, this.emailError));
    this.password.addEventListener('input', () => this.setFieldError(this.password, this.passwordError));

    try {
      const user = await this.authService.restoreSession();
      if (user) this.showGame();
      else this.showLogin();
    } catch {
      this.showLogin();
      this.formError.textContent = 'Your session could not be restored. Please sign in again.';
      this.formError.hidden = false;
    }
  }

  private async handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    this.clearErrors();

    const credentials: SignInCredentials = {
      email: this.email.value,
      password: this.password.value,
      keepSignedIn: this.keepSignedIn.checked,
    };
    const errors = validateCredentials(credentials);
    this.setFieldError(this.email, this.emailError, errors.email);
    this.setFieldError(this.password, this.passwordError, errors.password);
    if (errors.email || errors.password) {
      (errors.email ? this.email : this.password).focus();
      return;
    }

    this.setPending(true);
    try {
      await this.authService.signIn(credentials);
      this.form.reset();
      this.showGame();
    } catch (error) {
      this.formError.textContent = error instanceof InvalidCredentialsError
        ? error.message
        : 'Sign-in is temporarily unavailable. Please try again.';
      this.formError.hidden = false;
      this.password.select();
    } finally {
      this.setPending(false);
    }
  }

  private showGame(): void {
    window.location.replace(`${import.meta.env.BASE_URL}battle.html`);
  }

  private showLogin(): void {
    this.loginScreen.hidden = false;
    this.password.value = '';
    this.email.focus();
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
    this.submitButton.textContent = pending ? 'Entering the arena…' : 'Enter the arena';
    this.form.setAttribute('aria-busy', String(pending));
  }

  private clearErrors(): void {
    this.setFieldError(this.email, this.emailError);
    this.setFieldError(this.password, this.passwordError);
    this.formError.hidden = true;
    this.formError.textContent = '';
  }

  private setFieldError(input: HTMLInputElement, output: HTMLElement, message?: string): void {
    input.setAttribute('aria-invalid', String(Boolean(message)));
    output.textContent = message ?? '';
  }
}
