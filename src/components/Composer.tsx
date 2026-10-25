import { useEffect, useRef, type RefObject } from 'react';

interface Props {
  busy: boolean;
  disabled: boolean;
  providerLabel: string;
  placeholder: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onSend: (text: string) => void;
  onStop: () => void;
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

export function Composer({
  busy,
  disabled,
  providerLabel,
  placeholder,
  inputRef,
  onSend,
  onStop,
}: Props) {
  const ref = inputRef;
  const mounted = useRef(false);

  // Autofocus once, so the first keystroke goes to the question box.
  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    if (window.matchMedia('(pointer: fine)').matches) ref.current?.focus();
  }, [ref]);

  // ⌘K / Ctrl+K focuses the composer from anywhere.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [ref]);

  const resize = () => {
    const element = ref.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  };

  useEffect(resize, [placeholder, ref]);

  const submit = () => {
    const value = ref.current?.value ?? '';
    if (!value.trim() || busy || disabled) return;
    onSend(value);
    if (ref.current) {
      ref.current.value = '';
      ref.current.style.height = 'auto';
      ref.current.focus();
    }
  };

  return (
    <div className="composer">
      <div className="composer-inner">
        <textarea
          ref={ref}
          className="composer-input"
          rows={1}
          placeholder={placeholder}
          disabled={disabled}
          onChange={resize}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        {busy ? (
          <button type="button" className="btn btn-stop" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={submit} disabled={disabled}>
            Ask
          </button>
        )}
      </div>
      <div className="composer-hint">
        <span className="composer-keys">
          <kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line ·{' '}
          <kbd>{IS_MAC ? '⌘' : 'Ctrl'}</kbd>+<kbd>K</kbd> focus
        </span>
        <span className="composer-provider">{providerLabel}</span>
      </div>
    </div>
  );
}
