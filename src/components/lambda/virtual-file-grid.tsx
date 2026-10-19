import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef, useState } from 'react';

/**
 * Windowed grid renderer for large file lists (hundreds to thousands of
 * items). Only mounts the rows currently in/near the viewport instead of
 * every FileCard at once — the DOM-node count stays flat regardless of how
 * many files a subject/search result has.
 *
 * Column count is derived from the container's width (matching the CSS
 * grid's `repeat(auto-fill, minmax(180px, 1fr))` sizing) via ResizeObserver,
 * so the virtualization math stays in sync with the actual layout at any
 * viewport size.
 */
export function VirtualFileGrid<T>({
  items,
  renderItem,
  minColumnWidth = 180,
  rowHeight = 112,
  gap = 12,
  maxHeight = 600,
  className,
}: {
  items: readonly T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  minColumnWidth?: number;
  rowHeight?: number;
  gap?: number;
  maxHeight?: number;
  className?: string;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const update = () => {
      const width = el.clientWidth;
      const next = Math.max(1, Math.floor((width + gap) / (minColumnWidth + gap)));
      setColumns(next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [minColumnWidth, gap]);

  const rowCount = Math.ceil(items.length / columns);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight + gap,
    overscan: 4,
  });

  return (
    <div ref={parentRef} className={className} style={{ height: maxHeight, overflow: 'auto' }}>
      <div style={{ position: 'relative', height: virtualizer.getTotalSize(), width: '100%' }}>
        {virtualizer.getVirtualItems().map(row => {
          const start = row.index * columns;
          const rowItems = items.slice(start, start + columns);
          return (
            <div
              key={row.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: row.size,
                transform: `translateY(${row.start}px)`,
                display: 'grid',
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
                gap,
              }}
            >
              {rowItems.map((item, i) => renderItem(item, start + i))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
