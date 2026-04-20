import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Item, PaginatedItems } from '../interfaces/item.interface';

const API = '/api';

@Injectable({ providedIn: 'root' })
export class ItemService {
  private http = inject(HttpClient);

  getItems(filters?: {
    type?: string;
    status?: string;
    category?: number;
    search?: string;
    page?: number;
  }): Observable<PaginatedItems> {
    let params = new HttpParams();
    if (filters?.type) params = params.set('type', filters.type);
    if (filters?.status) params = params.set('status', filters.status);
    if (filters?.category) params = params.set('category', filters.category.toString());
    if (filters?.search) params = params.set('search', filters.search);
    if (filters?.page) params = params.set('page', filters.page.toString());
    return this.http.get<PaginatedItems>(`${API}/items/`, { params });
  }

  getItem(id: number): Observable<Item> {
    return this.http.get<Item>(`${API}/items/${id}/`);
  }

  createItem(data: any): Observable<Item> {
    return this.http.post<Item>(`${API}/items/`, data);
  }

  updateItem(id: number, data: any): Observable<Item> {
    return this.http.put<Item>(`${API}/items/${id}/`, data);
  }

  deleteItem(id: number): Observable<void> {
    return this.http.delete<void>(`${API}/items/${id}/`);
  }

  getMyItems(): Observable<Item[]> {
    return this.http.get<Item[]>(`${API}/items/my/`);
  }
}
