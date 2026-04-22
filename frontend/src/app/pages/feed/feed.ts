import { Component, OnInit, inject, signal } from '@angular/core';
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
    <div class="px-4 sm:px-6 py-6">
      <!-- Stats -->
      @if (stats) {
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div class="bg-white rounded-xl border border-gray-200 p-4">
            <div class="text-xs font-medium text-gray-500 uppercase tracking-wide">Total</div>
            <div class="text-3xl font-bold text-gray-900 mt-1">{{ stats.total_items }}</div>
          </div>
          <div class="bg-white rounded-xl border border-gray-200 p-4">
            <div class="text-xs font-medium text-gray-500 uppercase tracking-wide">Open</div>
            <div class="text-3xl font-bold text-emerald-600 mt-1">{{ stats.open_items }}</div>
          </div>
          <div class="bg-white rounded-xl border border-gray-200 p-4">
            <div class="text-xs font-medium text-gray-500 uppercase tracking-wide">Resolved</div>
            <div class="text-3xl font-bold text-blue-600 mt-1">{{ stats.resolved_items }}</div>
          </div>
          <div class="bg-white rounded-xl border border-gray-200 p-4">
            <div class="text-xs font-medium text-gray-500 uppercase tracking-wide">Lost · active</div>
            <div class="text-3xl font-bold text-rose-600 mt-1">{{ stats.lost_active }}</div>
          </div>
        </div>
      }

      <!-- Filters + search -->
      <div class="flex flex-col gap-3 mb-6">
        <div class="flex flex-wrap items-center gap-3">
          <div class="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
            <button (click)="setType('')"
              [class]="typeFilter === '' ? 'px-3 py-1.5 text-sm rounded-md bg-gray-900 text-white font-medium' : 'px-3 py-1.5 text-sm rounded-md text-gray-600 hover:bg-gray-100'"
            >All</button>
            <button (click)="setType('LOST')"
              [class]="typeFilter === 'LOST' ? 'px-3 py-1.5 text-sm rounded-md bg-rose-600 text-white font-medium' : 'px-3 py-1.5 text-sm rounded-md text-rose-700 hover:bg-rose-50'"
            >Lost</button>
            <button (click)="setType('FOUND')"
              [class]="typeFilter === 'FOUND' ? 'px-3 py-1.5 text-sm rounded-md bg-emerald-600 text-white font-medium' : 'px-3 py-1.5 text-sm rounded-md text-emerald-700 hover:bg-emerald-50'"
            >Found</button>
          </div>

          <div class="flex flex-wrap gap-1.5">
            @for (cat of categories; track cat.id) {
              <button (click)="setCategory(cat.id)"
                [class]="categoryFilter === cat.id ? 'px-3 py-1.5 text-sm rounded-full bg-gray-900 text-white font-medium' : 'px-3 py-1.5 text-sm rounded-full bg-white border border-gray-200 text-gray-700 hover:border-gray-300'"
              >{{ cat.icon }} {{ cat.name }}</button>
            }
          </div>

          <div class="relative ml-auto w-full sm:w-64">
            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" stroke-linecap="round"/>
            </svg>
            <input [(ngModel)]="searchQuery" (keyup.enter)="loadItems()" type="text" placeholder="Search items…"
              class="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400" />
          </div>
        </div>
      </div>

      <!-- Items -->
      @if (loading) {
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          @for (_ of [1,2,3,4,5,6]; track $index) {
            <div class="rounded-xl bg-white border border-gray-200 overflow-hidden animate-pulse">
              <div class="aspect-[4/3] bg-gray-100"></div>
              <div class="p-4 space-y-2">
                <div class="h-4 bg-gray-100 rounded w-3/4"></div>
                <div class="h-3 bg-gray-100 rounded w-1/2"></div>
              </div>
            </div>
          }
        </div>
      } @else if (items.length === 0) {
        <div class="mt-12 text-center py-16 px-4 bg-white border border-dashed border-gray-300 rounded-xl">
          <div class="text-5xl mb-3">🔎</div>
          <h3 class="text-lg font-medium text-gray-900">Nothing here yet</h3>
          <p class="text-sm text-gray-500 mt-1">Try a different filter or be the first to post.</p>
        </div>
      } @else {
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          @for (item of items; track item.id) {
            <a [routerLink]="['/items', item.id]"
              class="group bg-white rounded-xl border border-gray-200 overflow-hidden hover:border-gray-300 hover:shadow-sm transition flex flex-col">

              <!-- Image or placeholder (always same aspect ratio) -->
              <div class="aspect-[4/3] bg-gradient-to-br from-gray-100 to-gray-200 relative overflow-hidden">
                @if (item.image && !failed().has(item.id)) {
                  <img [src]="item.image" alt=""
                    (error)="markFailed(item.id)"
                    class="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300" />
                } @else {
                  <div class="absolute inset-0 flex items-center justify-center text-5xl opacity-60">
                    {{ item.category_detail.icon || '📦' }}
                  </div>
                }
                <!-- Status corner badge -->
                @if (item.status === 'RESOLVED') {
                  <span class="absolute top-2 right-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded-full bg-blue-600 text-white shadow-sm">Resolved</span>
                }
              </div>

              <!-- Content -->
              <div class="p-4 flex flex-col flex-1">
                <div class="flex items-center gap-1.5 mb-2">
                  <span [class]="item.item_type === 'LOST' ? 'px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded-full bg-rose-100 text-rose-700' : 'px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded-full bg-emerald-100 text-emerald-700'">
                    {{ item.item_type }}
                  </span>
                  @if (item.category_detail) {
                    <span class="text-xs text-gray-500">{{ item.category_detail.icon }} {{ item.category_detail.name }}</span>
                  }
                  @if (item.pending_claims_count > 0 && item.status !== 'RESOLVED') {
                    <span class="ml-auto px-2 py-0.5 text-[10px] font-semibold rounded-full bg-yellow-100 text-yellow-800">{{ item.pending_claims_count }} pending</span>
                  }
                </div>

                <h3 class="font-semibold text-gray-900 leading-snug line-clamp-1">{{ item.title }}</h3>
                <p class="text-sm text-gray-600 line-clamp-2 mt-1">{{ item.description }}</p>

                <div class="flex items-center justify-between text-xs text-gray-500 mt-auto pt-3">
                  <span class="flex items-center gap-1 min-w-0">
                    <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M12 22s-8-7.5-8-13a8 8 0 1 1 16 0c0 5.5-8 13-8 13Z" stroke-linecap="round" stroke-linejoin="round"/>
                      <circle cx="12" cy="9" r="2.5"/>
                    </svg>
                    <span class="truncate">{{ item.location }}</span>
                  </span>
                  <span class="shrink-0 ml-2">{{ item.created_at | date:'mediumDate' }}</span>
                </div>
              </div>
            </a>
          }
        </div>
      }
    </div>
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

  failed = signal<Set<number>>(new Set());

  ngOnInit() {
    this.categoryService.getCategories().subscribe(cats => this.categories = cats);
    this.statsService.getStats().subscribe(s => this.stats = s);
    this.loadItems();
  }

  loadItems() {
    this.loading = true;
    this.failed.set(new Set());
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

  markFailed(id: number) {
    const next = new Set(this.failed());
    next.add(id);
    this.failed.set(next);
  }
}
