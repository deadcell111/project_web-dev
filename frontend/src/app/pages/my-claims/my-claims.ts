import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ClaimService } from '../../services/claim.service';
import { MyClaim } from '../../interfaces/claim.interface';

@Component({
  selector: 'app-my-claims',
  standalone: true,
  imports: [DatePipe, RouterLink],
  template: `
    <div class="max-w-3xl mx-auto p-6">
      <h1 class="text-2xl font-semibold mb-6">My claims</h1>
      @if (loading()) {
        <p class="text-gray-500">Loading…</p>
      } @else if (claims().length === 0) {
        <p class="text-gray-500">You haven't claimed any items yet.</p>
      } @else {
        <div class="space-y-3">
          @for (c of claims(); track c.id) {
            <a [routerLink]="['/items', c.item]" class="block p-4 bg-white border border-gray-200 rounded-lg hover:border-gray-300">
              <div class="flex items-start gap-4">
                @if (c.item_snapshot.image) {
                  <img [src]="c.item_snapshot.image" class="w-16 h-16 rounded-md object-cover" />
                }
                <div class="flex-1">
                  <div class="flex items-center gap-2">
                    <span class="text-xs px-2 py-0.5 rounded-full border"
                      [class.bg-yellow-50]="c.status === 'PENDING'"
                      [class.border-yellow-200]="c.status === 'PENDING'"
                      [class.text-yellow-800]="c.status === 'PENDING'"
                      [class.bg-green-50]="c.status === 'APPROVED'"
                      [class.border-green-200]="c.status === 'APPROVED'"
                      [class.text-green-800]="c.status === 'APPROVED'"
                      [class.bg-red-50]="c.status === 'REJECTED'"
                      [class.border-red-200]="c.status === 'REJECTED'"
                      [class.text-red-800]="c.status === 'REJECTED'"
                    >{{ c.status }}</span>
                    <h3 class="font-medium">{{ c.item_snapshot.title }}</h3>
                  </div>
                  <p class="text-sm text-gray-600 mt-1">{{ c.message }}</p>
                  <p class="text-xs text-gray-400 mt-1">{{ c.created_at | date:'medium' }}</p>
                  @if (c.status === 'APPROVED' && c.owner_telegram) {
                    <a [href]="'https://t.me/' + c.owner_telegram" target="_blank" class="inline-block mt-2 text-sm text-blue-600 hover:underline">
                      Contact owner on Telegram ▶
                    </a>
                  }
                </div>
              </div>
            </a>
          }
        </div>
      }
    </div>
  `,
})
export class MyClaims implements OnInit {
  private claimService = inject(ClaimService);
  claims = signal<MyClaim[]>([]);
  loading = signal(true);

  ngOnInit() {
    this.claimService.myClaims().subscribe({
      next: cs => { this.claims.set(cs); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
