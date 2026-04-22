import { Component, OnInit, inject } from '@angular/core';
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
    @if (!item) {
      <div class="text-center py-10 text-gray-500">Loading...</div>
    } @else {
      <div class="max-w-2xl mx-auto">
        <a routerLink="/feed" class="text-sm text-blue-600 hover:underline mb-4 inline-block">&larr; Back to feed</a>

        <div class="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          @if (item.image) {
            <img [src]="item.image" [alt]="item.title" class="w-full h-64 object-cover rounded-md mb-4" />
          }

          <div class="flex items-center gap-2 mb-3">
            <span [class]="item.item_type === 'LOST' ? 'px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700' : 'px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700'">
              {{ item.item_type }}
            </span>
            <span class="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">{{ item.status }}</span>
            @if (item.category_detail) {
              <span class="text-xs text-gray-500">{{ item.category_detail.icon }} {{ item.category_detail.name }}</span>
            }
          </div>

          <h1 class="text-2xl font-bold text-gray-900 mb-2">{{ item.title }}</h1>
          <p class="text-gray-700 mb-4">{{ item.description }}</p>

          <div class="flex flex-wrap gap-4 text-sm text-gray-500 mb-4">
            <span>Location: <strong class="text-gray-700">{{ item.location }}</strong></span>
            <span>By: <strong class="text-gray-700">{{ item.username }}</strong></span>
            <span>{{ item.created_at | date:'medium' }}</span>
          </div>

          <!-- Owner actions -->
          @if (isOwner) {
            <div class="flex gap-2 mb-4">
              <button (click)="startEdit()" class="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50">Edit</button>
              <button (click)="remove()" class="px-3 py-1.5 text-sm bg-white border border-red-300 text-red-600 rounded-md hover:bg-red-50">Delete</button>
            </div>
          }

          <!-- Claimant view: reveal owner telegram on approved claim -->
          @if (!isOwner && item.owner_telegram) {
            <a [href]="'https://t.me/' + item.owner_telegram" target="_blank" class="inline-block mt-2 mb-4 text-sm text-blue-600 hover:underline">
              Contact owner on Telegram ▶
            </a>
          }

          <!-- Withdraw pending claim -->
          @if (myPendingClaim) {
            <div class="mb-4">
              <button (click)="withdraw()" class="text-sm text-red-600 hover:underline">
                Withdraw my claim
              </button>
            </div>
          }

          <!-- Claim form (non-owner, open/claimed) -->
          @if (!isOwner && (isLoggedIn$ | async) && item.status !== 'RESOLVED') {
            <div class="border-t border-gray-200 pt-4 mt-4">
              <h3 class="text-lg font-semibold mb-3">Submit a Claim</h3>
              @if (claimSuccess) {
                <div class="p-3 bg-green-50 border border-green-200 rounded-md text-green-700 text-sm mb-3">Claim submitted!</div>
              }
              @if (claimError) {
                <div class="p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm mb-3">{{ claimError }}</div>
              }
              <textarea [(ngModel)]="claimMessage" rows="3" placeholder="Describe why this is yours / how you found it..."
                class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"></textarea>
              <button (click)="submitClaim()" [disabled]="!claimMessage.trim()"
                class="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 cursor-pointer">
                Submit Claim
              </button>
            </div>
          }

          <!-- Claims list (owner only) -->
          @if (isOwner && item.claims && item.claims.length > 0) {
            <div class="border-t border-gray-200 pt-4 mt-4">
              <h3 class="text-lg font-semibold mb-3">Claims ({{ item.claims.length }})</h3>
              @for (claim of item.claims; track claim.id) {
                <div class="bg-gray-50 rounded-md p-4 mb-3">
                  <div class="flex items-center justify-between mb-2">
                    <span class="font-medium text-gray-900">{{ claim.username }}</span>
                    <span [class]="claim.status === 'PENDING' ? 'px-2 py-0.5 text-xs rounded-full bg-yellow-100 text-yellow-700' : claim.status === 'APPROVED' ? 'px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700' : 'px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-700'">
                      {{ claim.status }}
                    </span>
                  </div>
                  <p class="text-sm text-gray-700 mb-2">{{ claim.message }}</p>
                  <div class="text-xs text-gray-400 mb-2">{{ claim.created_at | date:'medium' }}</div>
                  @if (claim.status === 'PENDING') {
                    <div class="flex gap-2">
                      <button (click)="approveClaim(claim.id)" class="px-3 py-1 bg-green-600 text-white text-xs rounded-md hover:bg-green-700 cursor-pointer">Approve</button>
                      <button (click)="rejectClaim(claim.id)" class="px-3 py-1 bg-red-600 text-white text-xs rounded-md hover:bg-red-700 cursor-pointer">Reject</button>
                    </div>
                  }
                  @if (claim.status === 'APPROVED' && claim.user_telegram) {
                    <a [href]="'https://t.me/' + claim.user_telegram" target="_blank" class="text-sm text-blue-600 hover:underline">
                      Contact on Telegram ▶
                    </a>
                  }
                </div>
              }
            </div>
          }
        </div>
      </div>
    }
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

  ngOnInit() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.itemService.getItem(id).subscribe({
      next: (item) => {
        this.item = item;
        this.isOwner = this.auth.currentUser?.id === item.user;
      },
      error: () => this.router.navigate(['/feed']),
    });
  }

  submitClaim() {
    if (!this.item) return;
    this.claimError = '';
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

  deleteItem() {
    if (!this.item) return;
    this.itemService.deleteItem(this.item.id).subscribe(() => {
      this.router.navigate(['/my-items']);
    });
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
    this.claimService.withdraw(c.id).subscribe(() => this.loadItem());
  }

  private loadItem() {
    this.reloadItem();
  }

  private reloadItem() {
    if (!this.item) return;
    this.itemService.getItem(this.item.id).subscribe(item => {
      this.item = item;
    });
  }
}
