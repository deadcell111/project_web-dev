import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="max-w-md mx-auto mt-10">
      <div class="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <h1 class="text-2xl font-bold text-gray-900 mb-6">Login</h1>

        @if (error) {
          <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">{{ error }}</div>
        }

        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input [(ngModel)]="username" type="text" placeholder="Enter username"
              class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input [(ngModel)]="password" type="password" placeholder="Enter password"
              class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          </div>

          <button (click)="onLogin()" [disabled]="loading"
            class="w-full py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 cursor-pointer">
            {{ loading ? 'Signing in...' : 'Sign In' }}
          </button>
        </div>

        <p class="mt-4 text-sm text-gray-600 text-center">
          Don't have an account? <a routerLink="/register" class="text-blue-600 hover:underline">Register</a>
        </p>
      </div>
    </div>
  `
})
export class Login {
  private auth = inject(AuthService);
  private router = inject(Router);

  username = '';
  password = '';
  error = '';
  loading = false;

  onLogin() {
    this.error = '';
    this.loading = true;
    this.auth.login(this.username, this.password).subscribe({
      next: () => {
        this.router.navigate(['/feed']);
      },
      error: (err) => {
        this.loading = false;
        this.error = err.error?.non_field_errors?.[0] || err.error?.detail || 'Login failed.';
      }
    });
  }
}
