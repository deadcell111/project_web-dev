import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ItemService } from '../../services/item.service';
import { CategoryService } from '../../services/category.service';
import { Category } from '../../interfaces/category.interface';

@Component({
  selector: 'app-post-item',
  imports: [FormsModule],
  template: `
    <div class="max-w-lg mx-auto">
      <h1 class="text-2xl font-bold text-gray-900 mb-6">Report Lost or Found Item</h1>

      <div class="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        @if (error) {
          <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">{{ error }}</div>
        }

        <div class="space-y-4">
          <!-- Type -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Type *</label>
            <div class="flex gap-2">
              <button (click)="itemType = 'LOST'"
                [class]="itemType === 'LOST' ? 'flex-1 py-2 text-sm rounded-md bg-red-600 text-white font-medium' : 'flex-1 py-2 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200'"
                class="cursor-pointer transition-colors">Lost</button>
              <button (click)="itemType = 'FOUND'"
                [class]="itemType === 'FOUND' ? 'flex-1 py-2 text-sm rounded-md bg-green-600 text-white font-medium' : 'flex-1 py-2 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200'"
                class="cursor-pointer transition-colors">Found</button>
            </div>
          </div>

          <!-- Title -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Title *</label>
            <input [(ngModel)]="title" type="text" placeholder="e.g. Blue AirPods Pro case"
              class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          </div>

          <!-- Description -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Description *</label>
            <textarea [(ngModel)]="description" rows="3" placeholder="Detailed description..."
              class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"></textarea>
          </div>

          <!-- Category -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Category *</label>
            <div class="flex flex-wrap gap-2">
              @for (cat of categories; track cat.id) {
                <button (click)="categoryId = cat.id"
                  [class]="categoryId === cat.id ? 'px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white' : 'px-3 py-1.5 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200'"
                  class="cursor-pointer transition-colors">{{ cat.icon }} {{ cat.name }}</button>
              }
            </div>
          </div>

          <!-- Location -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Location *</label>
            <input [(ngModel)]="location" type="text" placeholder="e.g. Library 2nd floor, Room 301"
              class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          </div>

          <!-- Image URL -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Image URL (optional)</label>
            <input [(ngModel)]="imageUrl" type="text" placeholder="https://..."
              class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          </div>

          <button (click)="onSubmit()" [disabled]="loading || !isValid()"
            class="w-full py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 cursor-pointer">
            {{ loading ? 'Posting...' : 'Post Item' }}
          </button>
        </div>
      </div>
    </div>
  `
})
export class PostItem implements OnInit {
  private itemService = inject(ItemService);
  private categoryService = inject(CategoryService);
  private router = inject(Router);

  categories: Category[] = [];
  itemType: 'LOST' | 'FOUND' = 'LOST';
  title = '';
  description = '';
  categoryId: number | null = null;
  location = '';
  imageUrl = '';
  error = '';
  loading = false;

  ngOnInit() {
    this.categoryService.getCategories().subscribe(cats => this.categories = cats);
  }

  isValid(): boolean {
    return !!this.title.trim() && !!this.description.trim() && !!this.categoryId && !!this.location.trim();
  }

  onSubmit() {
    this.error = '';
    this.loading = true;

    const body: any = {
      title: this.title,
      description: this.description,
      item_type: this.itemType,
      category: this.categoryId,
      location: this.location,
    };
    if (this.imageUrl.trim()) {
      body.image = this.imageUrl;
    }

    this.itemService.createItem(body).subscribe({
      next: (item) => {
        this.router.navigate(['/items', item.id]);
      },
      error: (err) => {
        this.loading = false;
        this.error = err.error?.detail || 'Failed to create item.';
      }
    });
  }
}
