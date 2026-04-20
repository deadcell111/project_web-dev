import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-register',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="max-w-md mx-auto mt-10">
      <div class="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <h1 class="text-2xl font-bold text-gray-900 mb-6">Register</h1>

        @if (error) {
          <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">{{ error }}</div>
        }

        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Username *</label>
            <input [(ngModel)]="form.username" type="text" placeholder="Choose a username"
              class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Email *</label>
            <input [(ngModel)]="form.email" type="email" placeholder="your@email.com"
              class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Password *</label>
            <input [(ngModel)]="form.password" type="password" placeholder="Min 8 characters"
              class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">First Name</label>
              <input [(ngModel)]="form.first_name" type="text"
                class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
              <input [(ngModel)]="form.last_name" type="text"
                class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Telegram</label>
            <input [(ngModel)]="form.telegram" type="text" placeholder="@handle"
              class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          </div>

          <button (click)="onRegister()" [disabled]="loading"
            class="w-full py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 cursor-pointer">
            {{ loading ? 'Creating account...' : 'Create Account' }}
          </button>
        </div>

        <p class="mt-4 text-sm text-gray-600 text-center">
          Already have an account? <a routerLink="/login" class="text-blue-600 hover:underline">Login</a>
        </p>
      </div>
    </div>
  `
})
export class Register {
  private auth = inject(AuthService);
  private router = inject(Router);

  form = {
    username: '',
    email: '',
    password: '',
    first_name: '',
    last_name: '',
    telegram: '',
  };
  error = '';
  loading = false;

  onRegister() {
    this.error = '';
    this.loading = true;
    this.auth.register(this.form).subscribe({
      next: () => {
        this.router.navigate(['/feed']);
      },
      error: (err) => {
        this.loading = false;
        const errors = err.error;
        if (typeof errors === 'object') {
          const firstKey = Object.keys(errors)[0];
          const val = errors[firstKey];
          this.error = Array.isArray(val) ? val[0] : val;
        } else {
          this.error = 'Registration failed.';
        }
      }
    });
  }
}
