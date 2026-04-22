import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe, AsyncPipe } from '@angular/common';
import { ItemService } from '../../services/item.service';
import { ClaimService } from '../../services/claim.service';
import { AuthService } from '../../services/auth.service';
import { Item } from '../../interfaces/item.interface';

@Component({
  selector: 'app-item-detail',
  imports: [FormsModule, DatePipe, AsyncPipe, RouterLink],
  template: `
    <div class="px-4 sm:px-6 py-6">
      @if (!item) {
        <div class="text-center py-20 text-gray-500">Loading…</div>
      } @else {
        <a routerLink="/feed" class="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 mb-4">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m15 18-6-6 6-6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Back to feed
        </a>

        <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div class="grid lg:grid-cols-5 gap-0">

            <!-- Image column (2/5) -->
            <div class="lg:col-span-2 aspect-[4/3] lg:aspect-auto bg-gradient-to-br from-gray-100 to-gray-200 relative">
              @if (item.image && !imageFailed()) {
                <img [src]="item.image" alt=""
                  (error)="imageFailed.set(true)"
                  class="absolute inset-0 w-full h-full object-cover" />
              } @else {
                <div class="absolute inset-0 flex items-center justify-center text-7xl opacity-60">
                  {{ item.category_detail.icon || '📦' }}
                </div>
              }
            </div>

            <!-- Content column (3/5) -->
            <div class="lg:col-span-3 p-6 lg:p-8">

              <!-- Status pills -->
              <div class="flex items-center gap-1.5 mb-3">
                <span [class]="item.item_type === 'LOST' ? 'px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded-full bg-rose-100 text-rose-700' : 'px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded-full bg-emerald-100 text-emerald-700'">
                  {{ item.item_type }}
                </span>
                <span [class]="item.status === 'RESOLVED' ? 'px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded-full bg-blue-100 text-blue-700' : 'px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded-full bg-gray-100 text-gray-700'">
                  {{ item.status }}
                </span>
                @if (item.category_detail) {
                  <span class="text-xs text-gray-500">{{ item.category_detail.icon }} {{ item.category_detail.name }}</span>
                }
              </div>

              <h1 class="text-2xl lg:text-3xl font-bold text-gray-900 leading-tight">{{ item.title }}</h1>
              <p class="text-gray-700 mt-2 whitespace-pre-line">{{ item.description }}</p>

              <dl class="grid grid-cols-2 gap-x-4 gap-y-3 mt-5 text-sm">
                <div>
                  <dt class="text-xs uppercase tracking-wide text-gray-500">Location</dt>
                  <dd class="font-medium text-gray-900 mt-0.5">{{ item.location }}</dd>
                </div>
                <div>
                  <dt class="text-xs uppercase tracking-wide text-gray-500">Posted by</dt>
                  <dd class="font-medium text-gray-900 mt-0.5">{{ item.username }}</dd>
                </div>
                <div class="col-span-2">
                  <dt class="text-xs uppercase tracking-wide text-gray-500">Posted</dt>
                  <dd class="font-medium text-gray-900 mt-0.5">{{ item.created_at | date:'medium' }}</dd>
                </div>
              </dl>

              <!-- Owner actions -->
              @if (isOwner) {
                <div class="flex gap-2 mt-6 pt-6 border-t border-gray-100">
                  <button (click)="startEdit()" class="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 font-medium">Edit</button>
                  <button (click)="remove()" class="px-3 py-1.5 text-sm bg-white border border-rose-300 text-rose-600 rounded-lg hover:bg-rose-50 font-medium">Delete</button>
                </div>
              }

              <!-- Contact reveal for claimant (approved) -->
              @if (!isOwner && item.owner_telegram) {
                <div class="mt-6 pt-6 border-t border-gray-100">
                  <div class="flex items-start gap-3 p-4 rounded-xl bg-blue-50 border border-blue-200">
                    <svg class="w-5 h-5 text-blue-600 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.56 6.9-1.64 7.73c-.12.55-.45.68-.91.42l-2.5-1.84-1.2 1.16c-.13.14-.25.25-.5.25l.17-2.51 4.61-4.17c.2-.18-.04-.28-.31-.1l-5.7 3.59-2.46-.77c-.53-.17-.54-.53.11-.79l9.63-3.71c.44-.16.83.1.7.74Z"/>
                    </svg>
                    <div class="flex-1">
                      <div class="text-sm font-medium text-blue-900">Your claim was approved</div>
                      <div class="text-sm text-blue-800 mt-0.5">Contact the owner to arrange the handover.</div>
                      <a [href]="'https://t.me/' + item.owner_telegram" target="_blank"
                        class="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
                        Open Telegram chat
                        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M7 17 17 7M8 7h9v9" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                      </a>
                    </div>
                  </div>
                </div>
              }

              <!-- Withdraw pending claim -->
              @if (myPendingClaim) {
                <div class="mt-6 pt-6 border-t border-gray-100">
                  <div class="flex items-center justify-between p-3 rounded-lg bg-yellow-50 border border-yellow-200">
                    <span class="text-sm text-yellow-900">Your claim is pending review.</span>
                    <button (click)="withdraw()" class="text-sm text-rose-600 hover:text-rose-700 font-medium">Withdraw</button>
                  </div>
                </div>
              }

              <!-- Claim form (non-owner, open, logged in, no pending claim) -->
              @if (!isOwner && (isLoggedIn$ | async) && item.status !== 'RESOLVED' && !myPendingClaim) {
                <div class="mt-6 pt-6 border-t border-gray-100">
                  <h3 class="text-sm font-semibold text-gray-900">
                    {{ item.item_type === 'LOST' ? 'Did you find this item?' : 'Is this item yours?' }}
                  </h3>
                  <p class="text-sm text-gray-600 mt-1">
                    {{ item.item_type === 'LOST'
                      ? 'Let the owner know you have it. Describe the item and where you found it.'
                      : 'Describe identifying details so the finder can verify it belongs to you.' }}
                  </p>

                  @if (claimSuccess) {
                    <div class="p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm mt-3">
                      Claim sent. You'll be notified when the owner responds.
                    </div>
                  }
                  @if (claimError) {
                    <div class="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm mt-3">{{ claimError }}</div>
                  }

                  <textarea [(ngModel)]="claimMessage" rows="3"
                    [placeholder]="item.item_type === 'LOST' ? 'e.g. I found it in the library near study room 302 on Monday...' : 'e.g. Silver keys with a KBTU lanyard and 3 keys total...'"
                    class="w-full mt-3 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400"></textarea>
                  <button (click)="submitClaim()" [disabled]="!claimMessage.trim()"
                    class="mt-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition">
                    {{ item.item_type === 'LOST' ? 'I have this item' : 'This is mine' }}
                  </button>
                </div>
              }

              <!-- CTA for anonymous users -->
              @if (!isOwner && !(isLoggedIn$ | async) && item.status !== 'RESOLVED') {
                <div class="mt-6 pt-6 border-t border-gray-100">
                  <a routerLink="/login" class="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800">
                    Log in to {{ item.item_type === 'LOST' ? 'report that you found it' : 'claim this item' }}
                  </a>
                </div>
              }

              <!-- Resolved banner -->
              @if (item.status === 'RESOLVED' && !item.owner_telegram) {
                <div class="mt-6 pt-6 border-t border-gray-100">
                  <div class="p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-900">
                    This item has been returned to its owner. 🎉
                  </div>
                </div>
              }

            </div>
          </div>

          <!-- Claims section (owner only) -->
          @if (isOwner && item.claims && item.claims.length > 0) {
            <div class="border-t border-gray-200 p-6 lg:p-8 bg-gray-50/50">
              <h2 class="text-lg font-semibold text-gray-900 mb-4">
                {{ item.item_type === 'LOST' ? 'People who say they found it' : 'People claiming this item' }}
                <span class="text-gray-400 font-normal">({{ item.claims.length }})</span>
              </h2>
              <div class="space-y-3">
                @for (claim of item.claims; track claim.id) {
                  <div class="bg-white rounded-xl border border-gray-200 p-4">
                    <div class="flex items-start justify-between mb-2">
                      <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium text-gray-700">
                          {{ claim.username.charAt(0).toUpperCase() }}
                        </div>
                        <div>
                          <div class="text-sm font-medium text-gray-900">{{ claim.username }}</div>
                          <div class="text-xs text-gray-500">{{ claim.created_at | date:'medium' }}</div>
                        </div>
                      </div>
                      <span [class]="
                        claim.status === 'PENDING' ? 'px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded-full bg-yellow-100 text-yellow-800' :
                        claim.status === 'APPROVED' ? 'px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded-full bg-emerald-100 text-emerald-700' :
                        'px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded-full bg-gray-100 text-gray-600'">
                        {{ claim.status }}
                      </span>
                    </div>

                    <p class="text-sm text-gray-700 mt-2 whitespace-pre-line">{{ claim.message }}</p>

                    @if (claim.status === 'PENDING') {
                      <div class="flex gap-2 mt-3">
                        <button (click)="approveClaim(claim.id)" class="px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700">
                          Approve
                        </button>
                        <button (click)="rejectClaim(claim.id)" class="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50">
                          Reject
                        </button>
                      </div>
                    }

                    @if (claim.status === 'APPROVED' && claim.user_telegram) {
                      <a [href]="'https://t.me/' + claim.user_telegram" target="_blank"
                        class="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700">
                        Contact {{ claim.username }} on Telegram
                        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M7 17 17 7M8 7h9v9" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                      </a>
                    }
                  </div>
                }
              </div>
            </div>
          }

        </div>
      }
    </div>
  `
})
export class ItemDetail implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private itemService = inject(ItemService);
  private claimService = inject(ClaimService);
  private auth = inject(AuthService);

  isLoggedIn$ = this.auth.isLoggedIn$;
  item: Item | null = null;
  isOwner = false;
  claimMessage = '';
  claimSuccess = false;
  claimError = '';

  imageFailed = signal(false);

  ngOnInit() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.itemService.getItem(id).subscribe({
      next: (item) => {
        this.item = item;
        this.imageFailed.set(false);
        this.isOwner = this.auth.currentUser?.id === item.user;
      },
      error: () => this.router.navigate(['/feed']),
    });
  }

  submitClaim() {
    if (!this.item) return;
    this.claimError = '';
    this.claimSuccess = false;
    this.claimService.createClaim(this.item.id, this.claimMessage).subscribe({
      next: () => {
        this.claimSuccess = true;
        this.claimMessage = '';
        this.reloadItem();
      },
      error: (err) => {
        this.claimError = err.error?.detail || 'Failed to submit claim.';
      }
    });
  }

  approveClaim(claimId: number) {
    this.claimService.approveClaim(claimId).subscribe(() => this.reloadItem());
  }

  rejectClaim(claimId: number) {
    this.claimService.rejectClaim(claimId).subscribe(() => this.reloadItem());
  }

  get myPendingClaim() {
    const me = this.auth.currentUser;
    if (!me || !this.item) return null;
    return this.item.claims?.find(c => c.user === me.id && c.status === 'PENDING') ?? null;
  }

  remove() {
    if (!confirm('Delete this item?')) return;
    this.itemService.deleteItem(this.item!.id).subscribe(() => this.router.navigate(['/my-items']));
  }

  startEdit() {
    this.router.navigate(['/items', this.item!.id, 'edit']);
  }

  withdraw() {
    const c = this.myPendingClaim;
    if (!c) return;
    this.claimService.withdraw(c.id).subscribe(() => this.reloadItem());
  }

  private reloadItem() {
    if (!this.item) return;
    this.itemService.getItem(this.item.id).subscribe(item => {
      this.item = item;
      this.imageFailed.set(false);
    });
  }
}
