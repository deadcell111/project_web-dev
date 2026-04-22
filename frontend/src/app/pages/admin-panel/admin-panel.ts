import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { AdminService } from '../../services/admin.service';
import { CategoryService } from '../../services/category.service';
import { StatsService, Stats } from '../../services/stats.service';
import { Category } from '../../interfaces/category.interface';
import { Item } from '../../interfaces/item.interface';

type Tab = 'categories' | 'items' | 'stats';

@Component({
  selector: 'app-admin-panel',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <div class="max-w-5xl mx-auto p-6">
      <h1 class="text-2xl font-semibold mb-6">Admin Panel</h1>
      <nav class="flex gap-1 mb-6 border-b border-gray-200">
        @for (t of tabs; track t) {
          <button (click)="tab.set(t)"
            class="px-4 py-2 text-sm font-medium border-b-2 capitalize"
            [class.border-gray-900]="tab() === t"
            [class.text-gray-900]="tab() === t"
            [class.border-transparent]="tab() !== t"
            [class.text-gray-500]="tab() !== t">{{ t }}</button>
        }
      </nav>

      @switch (tab()) {
        @case ('categories') {
          <section class="space-y-4">
            <div class="flex gap-2">
              <input [(ngModel)]="newCat.name" placeholder="Name" class="px-3 py-2 border border-gray-300 rounded-md" />
              <input [(ngModel)]="newCat.icon" placeholder="Icon (emoji)" class="w-24 px-3 py-2 border border-gray-300 rounded-md" />
              <button (click)="addCat()" class="px-4 py-2 bg-gray-900 text-white rounded-md">Add</button>
            </div>
            <ul class="divide-y divide-gray-100 border border-gray-200 rounded-md">
              @for (c of cats(); track c.id) {
                <li class="flex items-center gap-4 px-4 py-3">
                  <span class="text-2xl">{{ c.icon }}</span>
                  <span class="flex-1">{{ c.name }}</span>
                  <button (click)="deleteCat(c)" class="text-sm text-red-600 hover:underline">Delete</button>
                </li>
              }
            </ul>
          </section>
        }
        @case ('items') {
          <section class="space-y-4">
            <div class="flex gap-2 items-center">
              <select [(ngModel)]="filter.status" (change)="loadItems()" class="px-3 py-2 border border-gray-300 rounded-md">
                <option value="">All statuses</option>
                <option value="OPEN">Open</option>
                <option value="RESOLVED">Resolved</option>
              </select>
              <select [(ngModel)]="filter.type" (change)="loadItems()" class="px-3 py-2 border border-gray-300 rounded-md">
                <option value="">All types</option>
                <option value="LOST">Lost</option>
                <option value="FOUND">Found</option>
              </select>
            </div>
            <div class="space-y-2">
              @for (it of items(); track it.id) {
                <div class="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-md">
                  <div class="flex-1">
                    <div class="text-sm font-medium">[{{ it.item_type }}] {{ it.title }}</div>
                    <div class="text-xs text-gray-500">{{ it.username }} · {{ it.status }} · {{ it.created_at | date:'short' }}</div>
                  </div>
                  @if (it.status !== 'RESOLVED') {
                    <button (click)="forceResolve(it)" class="text-sm text-yellow-700 hover:underline">Force resolve</button>
                  }
                  <button (click)="deleteItem(it)" class="text-sm text-red-600 hover:underline">Delete</button>
                </div>
              }
            </div>
          </section>
        }
        @case ('stats') {
          @if (stats()) {
            <section class="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div class="p-4 bg-white border border-gray-200 rounded-md"><div class="text-xs text-gray-500">Total items</div><div class="text-2xl font-semibold">{{ stats()!.total_items }}</div></div>
              <div class="p-4 bg-white border border-gray-200 rounded-md"><div class="text-xs text-gray-500">Open</div><div class="text-2xl font-semibold">{{ stats()!.open_items }}</div></div>
              <div class="p-4 bg-white border border-gray-200 rounded-md"><div class="text-xs text-gray-500">Resolved</div><div class="text-2xl font-semibold">{{ stats()!.resolved_items }}</div></div>
              <div class="p-4 bg-white border border-gray-200 rounded-md"><div class="text-xs text-gray-500">Lost (active)</div><div class="text-2xl font-semibold">{{ stats()!.lost_active }}</div></div>
            </section>
          }
        }
      }
    </div>
  `,
})
export class AdminPanel implements OnInit {
  private admin = inject(AdminService);
  private categoryService = inject(CategoryService);
  private statsService = inject(StatsService);

  tabs: Tab[] = ['categories', 'items', 'stats'];
  tab = signal<Tab>('categories');

  cats = signal<Category[]>([]);
  newCat = { name: '', icon: '' };

  items = signal<Item[]>([]);
  filter = { status: '', type: '' };

  stats = signal<Stats | null>(null);

  ngOnInit() {
    this.loadCats();
    this.loadItems();
    this.statsService.getStats().subscribe(s => this.stats.set(s));
  }

  loadCats() { this.categoryService.refresh().subscribe(cs => this.cats.set(cs)); }
  addCat() {
    if (!this.newCat.name || !this.newCat.icon) return;
    this.admin.createCategory(this.newCat).subscribe(() => { this.newCat = { name: '', icon: '' }; this.loadCats(); });
  }
  deleteCat(c: Category) {
    if (!confirm(`Delete "${c.name}"? Items in this category will also be deleted.`)) return;
    this.admin.deleteCategory(c.id).subscribe(() => this.loadCats());
  }

  loadItems() {
    this.admin.listItems({
      status: this.filter.status || undefined,
      type: this.filter.type || undefined,
    }).subscribe(res => this.items.set(res.results));
  }
  forceResolve(it: Item) {
    this.admin.forceResolve(it.id).subscribe(() => this.loadItems());
  }
  deleteItem(it: Item) {
    if (!confirm(`Delete "${it.title}"?`)) return;
    this.admin.deleteItem(it.id).subscribe(() => this.loadItems());
  }
}
