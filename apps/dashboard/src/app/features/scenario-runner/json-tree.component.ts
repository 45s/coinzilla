import { Component, Input, forwardRef, signal } from '@angular/core';

interface JsonTreeEntry {
  readonly key: string;
  readonly value: unknown;
  readonly path: string;
}

@Component({
  selector: 'app-json-tree',
  standalone: true,
  imports: [forwardRef(() => JsonTreeComponent)],
  template: `
    @if (isContainer) {
      <details class="json-tree-branch" [open]="depth < 1">
        <summary><code>{{ label }}</code> <small>{{ containerDescription }}</small></summary>
        <button type="button" class="copy-branch" (click)="copyValue($event)">Copy this branch</button>
        <div class="json-tree-children" role="group">
          @for (entry of entries; track entry.path) {
            <app-json-tree [label]="entry.key" [value]="entry.value" [depth]="depth + 1" [path]="entry.path" />
          }
        </div>
      </details>
    } @else {
      <div class="json-tree-leaf">
        <code>{{ label }}</code>
        <span>{{ displayValue }}</span>
        <button type="button" (click)="copyValue($event)">Copy value</button>
      </div>
    }
    @if (copied()) {
      <small class="json-tree-status" role="status">Copied</small>
    }
    @if (copyUnavailable()) {
      <small class="json-tree-status" role="status">Clipboard unavailable</small>
    }
  `,
  styles: [`
    :host{display:block;min-width:0;font-size:12px}
    .json-tree-branch{border-left:1px solid var(--line);padding:4px 0 4px 10px;margin:3px 0}
    summary{cursor:pointer;overflow-wrap:anywhere}
    summary small{color:var(--muted);margin-left:6px}
    .json-tree-children{padding-left:12px}
    .json-tree-leaf{display:grid;grid-template-columns:minmax(90px,auto) minmax(0,1fr) auto;align-items:start;gap:8px;padding:4px 0;border-bottom:1px solid var(--line)}
    .json-tree-leaf code{overflow-wrap:anywhere}
    .json-tree-leaf span{overflow-wrap:anywhere;white-space:pre-wrap}
    button{font:inherit;font-size:11px;border:1px solid var(--line);border-radius:6px;padding:3px 7px;background:var(--control-bg,#151e2b);color:var(--text,#e7edf5);cursor:pointer}
    .copy-branch{margin:5px 0 5px 16px}
    .json-tree-status{color:var(--accent,#65d6ad)}
    @media(max-width:560px){.json-tree-leaf{grid-template-columns:1fr auto}.json-tree-leaf span{grid-column:1/-1;grid-row:2}}
  `],
})
export class JsonTreeComponent {
  @Input({ required: true }) value!: unknown;
  @Input() label = 'root';
  @Input() depth = 0;
  @Input() path = 'root';

  readonly copied = signal(false);
  readonly copyUnavailable = signal(false);

  get isContainer(): boolean {
    return this.value !== null && typeof this.value === 'object';
  }

  get entries(): readonly JsonTreeEntry[] {
    if (Array.isArray(this.value)) {
      return this.value.map((value, index) => ({
        key: `[${index}]`,
        value,
        path: `${this.path}[${index}]`,
      }));
    }
    if (this.value && typeof this.value === 'object') {
      return Object.entries(this.value as Record<string, unknown>).map(([key, value]) => ({
        key,
        value,
        path: `${this.path}.${key}`,
      }));
    }
    return [];
  }

  get containerDescription(): string {
    return Array.isArray(this.value)
      ? `Array · ${this.value.length} items`
      : `Object · ${this.entries.length} fields`;
  }

  get displayValue(): string {
    if (this.value === null) {
      return 'null';
    }
    if (this.value === undefined) {
      return 'undefined';
    }
    if (typeof this.value === 'string') {
      return JSON.stringify(this.value) ?? '';
    }
    return String(this.value);
  }

  async copyValue(event: Event): Promise<void> {
    event.stopPropagation();
    this.copied.set(false);
    this.copyUnavailable.set(false);
    if (!navigator.clipboard?.writeText) {
      this.copyUnavailable.set(true);
      return;
    }
    const text = typeof this.value === 'string'
      ? this.value
      : JSON.stringify(this.value, null, 2) ?? String(this.value);
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(true);
    } catch {
      this.copyUnavailable.set(true);
    }
  }
}
