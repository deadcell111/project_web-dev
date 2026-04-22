import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Category } from '../interfaces/category.interface';
import { Item, PaginatedItems } from '../interfaces/item.interface';

@Injectable({ providedIn: 'root' })
export class AdminService {
  private http = inject(HttpClient);

  createCategory(data: { name: string; icon: string }): Observable<Category> {
    return this.http.post<Category>('/api/categories/', data);
  }
  updateCategory(id: number, data: Partial<Category>): Observable<Category> {
    return this.http.patch<Category>(`/api/categories/${id}/`, data);
  }
  deleteCategory(id: number): Observable<void> {
    return this.http.delete<void>(`/api/categories/${id}/`);
  }

  listItems(filters: { type?: string; status?: string; user_id?: number; page?: number }): Observable<PaginatedItems> {
    let qs = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v != null) qs.set(k, String(v)); });
    return this.http.get<PaginatedItems>(`/api/admin/items/?${qs.toString()}`);
  }

  forceResolve(itemId: number): Observable<Item> {
    return this.http.post<Item>(`/api/items/${itemId}/force-resolve/`, {});
  }

  deleteItem(itemId: number): Observable<void> {
    return this.http.delete<void>(`/api/items/${itemId}/`);
  }
}
