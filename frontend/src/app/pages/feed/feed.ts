import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { ItemService } from '../../services/item.service';
import { CategoryService } from '../../services/category.service';
import { StatsService, Stats } from '../../services/stats.service';
import { Item } from '../../interfaces/item.interface';
import { Category } from '../../interfaces/category.interface';

@Component({
  selector: 'app-feed',
  imports: [FormsModule, RouterLink, DatePipe],
  template: `
    <!-- Stats bar -->
    @if (stats) {
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div class="bg-white rounded-lg border border-gray-200 p-4 text-center">
          <div class="text-2xl font-bold text-gray-900">{{ stats.total_items }}</div>
          <div class="text-xs text-gray-500">Total</div>
        </div>
        <div class="bg-white rounded-lg border border-gray-200 p-4 text-center">
          <div class="text-2xl font-bold text-green-600">{{ stats.open_items }}</div>
          <div class="text-xs text-gray-500">Open</div>
        </div>
        <div class="bg-white rounded-lg border border-gray-200 p-4 text-center">
          <div class="text-2xl font-bold text-blue-600">{{ stats.resolved_items }}</div>
          <div class="text-xs text-gray-500">Resolved</div>
        </div>
        <div class="bg-white rounded-lg border border-gray-200 p-4 text-center">
          <div class="text-2xl font-bold text-red-500">{{ stats.lost_active }}</div>
          <div class="text-xs text-gray-500">Lost Active</div>
        </div>
      </div>
    }

    <!-- Filters -->
    <div class="bg-white rounded-lg border border-gray-200 p-4 mb-6">
      <div class="flex flex-wrap gap-3 items-center">
        <!-- Type filter -->
        <div class="flex gap-1">
          <button (click)="setType('')"
            [class]="typeFilter === '' ? 'px-3 py-1.5 text-sm rounded-md bg-gray-900 text-white' : 'px-3 py-1.5 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200'"
            class="cursor-pointer transition-colors">All</button>
          <button (click)="setType('LOST')"
            [class]="typeFilter === 'LOST' ? 'px-3 py-1.5 text-sm rounded-md bg-red-600 text-white' : 'px-3 py-1.5 text-sm rounded-md bg-red-50 text-red-700 hover:bg-red-100'"
            class="cursor-pointer transition-colors">Lost</button>
          <button (click)="setType('FOUND')"
            [class]="typeFilter === 'FOUND' ? 'px-3 py-1.5 text-sm rounded-md bg-green-600 text-white' : 'px-3 py-1.5 text-sm rounded-md bg-green-50 text-green-700 hover:bg-green-100'"
            class="cursor-pointer transition-colors">Found</button>
        </div>

        <!-- Category filter -->
        <div class="flex gap-1">
          @for (cat of categories; track cat.id) {
            <button (click)="setCategory(cat.id)"
              [class]="categoryFilter === cat.id ? 'px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white' : 'px-3 py-1.5 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200'"
              class="cursor-pointer transition-colors">{{ cat.icon }} {{ cat.name }}</button>
          }
        </div>

        <!-- Search -->
        <input [(ngModel)]="searchQuery" (keyup.enter)="loadItems()" type="text" placeholder="Search..."
          class="ml-auto px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-48" />
      </div>
    </div>

    <!-- Items grid -->
    @if (loading) {
      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mt-6">
        @for (_ of [1,2,3,4,5,6]; track $index) {
          <div class="rounded-lg bg-white border border-gray-200 overflow-hidden animate-pulse">
            <div class="h-40 bg-gray-100"></div>
            <div class="p-4 space-y-2">
              <div class="h-4 bg-gray-100 rounded w-3/4"></div>
              <div class="h-3 bg-gray-100 rounded w-1/2"></div>
            </div>
          </div>
        }
      </div>
    } @else if (items.length === 0) {
      <div class="mt-12 text-center py-16 px-4 bg-white border border-dashed border-gray-300 rounded-lg">
        <div class="text-5xl mb-3">🔎</div>
        <h3 class="text-lg font-medium text-gray-900">Nothing here yet</h3>
        <p class="text-sm text-gray-500 mt-1">Try a different filter or be the first to post.</p>
      </div>
    } @else {
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        @for (item of items; track item.id) {
          <a [routerLink]="['/items', item.id]"
            class="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow block">
            @if (item.image) {
              <img [src]="item.image" [alt]="item.title" class="w-full h-40 object-cover rounded-md mb-3" />
            }
            <div class="flex items-center gap-2 mb-2">
              <span [class]="item.item_type === 'LOST' ? 'px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700' : 'px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700'">
                {{ item.item_type }}
              </span>
              <span class="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">{{ item.status }}</span>
              @if (item.category_detail) {
                <span class="text-xs text-gray-500">{{ item.category_detail.icon }} {{ item.category_detail.name }}</span>
              }
            </div>
            <h3 class="font-semibold text-gray-900 mb-1">{{ item.title }}</h3>
            <p class="text-sm text-gray-600 line-clamp-2 mb-2">{{ item.description }}</p>
            <div class="flex items-center justify-between text-xs text-gray-400">
              <span>{{ item.location }}</span>
              <span>{{ item.created_at | date:'mediumDate' }}</span>
            </div>
          </a>
        }
      </div>
    }
  `
})
export class Feed implements OnInit {
  private itemService = inject(ItemService);
  private categoryService = inject(CategoryService);
  private statsService = inject(StatsService);

  items: Item[] = [];
  categories: Category[] = [];
  stats: Stats | null = null;
  typeFilter = '';
  categoryFilter: number | null = null;
  searchQuery = '';
  loading = false;

  ngOnInit() {
    this.categoryService.getCategories().subscribe(cats => this.categories = cats);
    this.statsService.getStats().subscribe(s => this.stats = s);
    this.loadItems();
  }

  loadItems() {
    this.loading = true;
    this.itemService.getItems({
      type: this.typeFilter || undefined,
      category: this.categoryFilter || undefined,
      search: this.searchQuery || undefined,
    }).subscribe({
      next: (res) => {
        this.items = res.results;
        this.loading = false;
      },
      error: () => this.loading = false,
    });
  }

  setType(type: string) {
    this.typeFilter = type;
    this.loadItems();
  }

  setCategory(id: number) {
    this.categoryFilter = this.categoryFilter === id ? null : id;
    this.loadItems();
  }
}
