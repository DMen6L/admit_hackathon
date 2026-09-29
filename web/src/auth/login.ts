import '../style.css';
import { AuthController } from './auth-controller';
import { DemoAuthService } from './auth-service';

void new AuthController(new DemoAuthService(window.localStorage, window.sessionStorage)).initialize();
