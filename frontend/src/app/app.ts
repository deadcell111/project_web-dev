import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AsyncPipe } from '@angular/common';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AsyncPipe],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  private auth = inject(AuthService);
  private router = inject(Router);

  currentUser$ = this.auth.currentUser$;
  isLoggedIn$ = this.auth.isLoggedIn$;

  constructor() {
    this.auth.loadUser();
  }

  logout() {
    this.auth.logout().subscribe(() => {
      this.router.navigate(['/feed']);
    });
  }
}
