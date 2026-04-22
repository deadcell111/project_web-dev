import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'feed', pathMatch: 'full' },
  { path: 'login', loadComponent: () => import('./pages/login/login').then(m => m.Login) },
  { path: 'register', loadComponent: () => import('./pages/register/register').then(m => m.Register) },
  { path: 'feed', loadComponent: () => import('./pages/feed/feed').then(m => m.Feed) },
  { path: 'items/:id', loadComponent: () => import('./pages/item-detail/item-detail').then(m => m.ItemDetail) },
  { path: 'my-items', loadComponent: () => import('./pages/my-items/my-items').then(m => m.MyItems), canActivate: [authGuard] },
  { path: 'post', loadComponent: () => import('./pages/post-item/post-item').then(m => m.PostItem), canActivate: [authGuard] },
  { path: 'profile', loadComponent: () => import('./pages/profile/profile').then(m => m.Profile), canActivate: [authGuard] },
  { path: 'my-claims', loadComponent: () => import('./pages/my-claims/my-claims').then(m => m.MyClaims), canActivate: [authGuard] },
  { path: 'items/:id/edit', loadComponent: () => import('./pages/item-edit/item-edit').then(m => m.ItemEdit), canActivate: [authGuard] },
];
