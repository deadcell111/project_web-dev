import { Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { ItemService } from '../../services/item.service';
import { Item } from '../../interfaces/item.interface';

@Component({
  selector: 'app-my-items',
  imports: [RouterLink, DatePipe],
  template: `
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold text-gray-900">My Items</h1>
      <a routerLink="/post" class="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors">
        + New Post
      </a>
    </div>

    @if (loading) {
      <div class="text-center py-10 text-gray-500">Loading...</div>
    } @else if (items.length === 0) {
      <div class="text-center py-10">
        <p class="text-gray-500 mb-4">You haven't posted any items yet.</p>
        <a routerLink="/post" class="text-blue-600 hover:underline">Post your first item</a>
      </div>
    } @else {
      <div class="space-y-4">
        @for (item of items; track item.id) {
          <div class="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow">
            <div class="flex items-start justify-between">
              <a [routerLink]="['/items', item.id]" class="flex-1 block">
                <div class="flex items-center gap-2 mb-1">
                  <span [class]="item.item_type === 'LOST' ? 'px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700' : 'px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700'">
                    {{ item.item_type }}
                  </span>
                  <span class="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">{{ item.status }}</span>
                  @if (item.category_detail) {
                    <span class="text-xs text-gray-500">{{ item.category_detail.icon }}</span>
                  }
                </div>
                <h3 class="font-semibold text-gray-900">{{ item.title }}</h3>
                <p class="text-sm text-gray-600 mt-1">{{ item.location }} &middot; {{ item.created_at | date:'mediumDate' }}</p>
              </a>
              @if (item.claims && item.claims.length > 0) {
                <div class="ml-4 px-3 py-1 bg-yellow-100 text-yellow-800 text-xs font-medium rounded-full">
                  {{ item.claims.length }} claim{{ item.claims.length > 1 ? 's' : '' }}
                </div>
              }
            </div>
            <div class="flex items-center gap-3 mt-2">
              <a [routerLink]="['/items', item.id, 'edit']" class="text-sm text-gray-600 hover:underline">Edit</a>
              <button (click)="delete(item)" class="text-sm text-red-600 hover:underline">Delete</button>
              @if (item.pending_claims_count > 0) {
                <span class="text-xs px-2 py-0.5 rounded-full bg-yellow-50 border border-yellow-200 text-yellow-800">
                  {{ item.pending_claims_count }} pending
                </span>
              }
            </div>
          </div>
        }
      </div>
    }
  `
})
export class MyItems implements OnInit {
  private itemService = inject(ItemService);

  items: Item[] = [];
  loading = false;

  ngOnInit() {
    this.loading = true;
    this.itemService.getMyItems().subscribe({
      next: (items) => {
        this.items = items;
        this.loading = false;
      },
      error: () => this.loading = false,
    });
  }

  delete(item: Item) {
    if (!confirm(`Delete "${item.title}"?`)) return;
    this.itemService.deleteItem(item.id).subscribe(() => {
      this.items = this.items.filter(i => i.id !== item.id);
    });
  }
}
