import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ImageUpload } from '../../components/image-upload/image-upload';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [FormsModule, RouterLink, ImageUpload],
  template: `
    <div class="max-w-xl mx-auto p-6">
      <h1 class="text-2xl font-semibold mb-6">Profile</h1>
      @if (saved()) {
        <div class="mb-4 p-3 bg-green-50 border border-green-200 rounded-md text-green-700 text-sm">Saved.</div>
      }
      @if (error()) {
        <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">{{ error() }}</div>
      }

      <div class="space-y-4 bg-white rounded-lg border border-gray-200 p-6">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Avatar</label>
          <app-image-upload kind="avatar" [existingUrl]="avatarUrl" (uploaded)="avatarKey = $event"></app-image-upload>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">First name</label>
          <input [(ngModel)]="form.first_name" class="w-full px-3 py-2 border border-gray-300 rounded-md" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Last name</label>
          <input [(ngModel)]="form.last_name" class="w-full px-3 py-2 border border-gray-300 rounded-md" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Telegram</label>
          <input [(ngModel)]="form.telegram" placeholder="@handle" class="w-full px-3 py-2 border border-gray-300 rounded-md" />
          <p class="text-xs text-gray-500 mt-1">Used to reach you when a claim is approved.</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Phone</label>
          <input [(ngModel)]="form.phone" class="w-full px-3 py-2 border border-gray-300 rounded-md" />
        </div>

        <div class="pt-2">
          <button (click)="save()" [disabled]="saving()" class="px-4 py-2 bg-gray-900 text-white rounded-md disabled:opacity-50">
            {{ saving() ? 'Saving…' : 'Save' }}
          </button>
          <a routerLink="/feed" class="ml-3 text-sm text-gray-600">Cancel</a>
        </div>
      </div>
    </div>
  `,
})
export class Profile implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);

  form = { first_name: '', last_name: '', telegram: '', phone: '' };
  avatarKey: string | null = null;
  avatarUrl: string | null = null;

  saving = signal(false);
  saved = signal(false);
  error = signal<string | null>(null);

  ngOnInit() {
    const u = this.auth.currentUser;
    if (!u) { this.router.navigate(['/login']); return; }
    this.form.first_name = u.first_name || '';
    this.form.last_name = u.last_name || '';
    this.form.telegram = u.telegram || '';
    this.form.phone = u.phone || '';
    this.avatarUrl = u.avatar;
    this.avatarKey = u.avatar_key;
  }

  save() {
    this.saving.set(true);
    this.saved.set(false);
    this.error.set(null);
    this.auth.updateProfile({
      ...this.form,
      avatar: this.avatarKey ?? '',
    } as any).subscribe({
      next: () => { this.saving.set(false); this.saved.set(true); },
      error: err => {
        this.saving.set(false);
        const e = err.error;
        this.error.set(typeof e === 'object' ? (Object.values(e)[0] as any) : 'Save failed.');
      },
    });
  }
}
