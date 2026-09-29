import '../style.css';
import { AuthController } from './auth-controller';
import { ApiAuthService } from './auth-service';

void new AuthController(new ApiAuthService(globalThis.fetch.bind(globalThis), window.localStorage, window.sessionStorage)).initialize();
