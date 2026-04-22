import { Component, HostListener, inject, signal } from '@angular/core';
import { AsyncPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [AsyncPipe, DatePipe, RouterLink],
  template: `
    <div class="relative">
      <button (click)="toggle($event)" class="relative p-2 rounded-md hover:bg-gray-100">
        <svg class="w-5 h-5 text-gray-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 16v-5a6 6 0 10-12 0v5l-2 2h16l-2-2z" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M10 20a2 2 0 004 0" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        @if ((notifications.unreadCount$ | async) as n) {
          @if (n > 0) {
            <span class="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold flex items-center justify-center">
              {{ n > 99 ? '99+' : n }}
            </span>
          }
        }
      </button>

      @if (open()) {
        <div class="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
          <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span class="font-medium">Notifications</span>
            <button (click)="markAll()" class="text-xs text-gray-500 hover:text-gray-700">Mark all read</button>
          </div>
          <div class="max-h-96 overflow-y-auto">
            @for (n of (notifications.list$ | async) ?? []; track n.id) {
              <a [routerLink]="['/items', n.item]" (click)="markRead(n.id)"
                 [class.bg-blue-50]="!n.read_at"
                 class="block px-4 py-3 border-b border-gray-100 hover:bg-gray-50">
                <div class="text-sm">{{ summary(n.kind, n.actor_username, n.item_title) }}</div>
                <div class="text-xs text-gray-400 mt-1">{{ n.created_at | date:'short' }}</div>
              </a>
            } @empty {
              <div class="px-4 py-8 text-center text-sm text-gray-400">No notifications</div>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class NotificationBell {
  notifications = inject(NotificationService);
  open = signal(false);

  toggle(ev: Event) { ev.stopPropagation(); this.open.update(v => !v); }

  @HostListener('document:click') closeOnOutside() { this.open.set(false); }

  summary(kind: string, actor: string | null, itemTitle: string): string {
    const a = actor ?? 'Someone';
    switch (kind) {
      case 'CLAIM_CREATED':   return `${a} claimed your "${itemTitle}"`;
      case 'CLAIM_APPROVED':  return `Your claim on "${itemTitle}" was approved`;
      case 'CLAIM_REJECTED':  return `Your claim on "${itemTitle}" was rejected`;
      case 'CLAIM_WITHDRAWN': return `${a} withdrew their claim on "${itemTitle}"`;
      default: return 'Notification';
    }
  }

  markRead(id: number) { this.notifications.markRead(id).subscribe(); }
  markAll() { this.notifications.markAllRead().subscribe(); }
}
