interface Props {
  variant?: 'panel' | 'hero';
  busy?: boolean;
  onBrowse: () => void;
}

/**
 * A real button, not a div: keyboard users get Enter/Space for free. Drag and
 * drop is handled globally by the app shell, so this only opens the file picker.
 */
export function DropZone({ variant = 'panel', busy = false, onBrowse }: Props) {
  return (
    <button
      type="button"
      className={`dropzone dropzone-${variant}`}
      onClick={onBrowse}
      disabled={busy}
    >
      <span className="dropzone-icon" aria-hidden>
        ⇪
      </span>
      <span className="dropzone-text">
        {variant === 'hero' ? 'Drop files anywhere, or click to browse' : 'Add documents'}
      </span>
      <span className="dropzone-hint">
        PDF, Markdown, text or code · parsed and embedded on this device
      </span>
    </button>
  );
}
