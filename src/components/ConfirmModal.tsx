import React, { useEffect, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { withBase } from '../basePath';
import { useT } from '../i18n';

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<Props> = ({
  title, message, confirmLabel, cancelLabel,
  danger = false, onConfirm, onCancel,
}) => {
  const { t } = useT();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const resolvedConfirmLabel = confirmLabel ?? t('common.confirm');
  const resolvedCancelLabel = cancelLabel ?? t('common.cancel');

  useEffect(() => {
    confirmRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onConfirm, onCancel]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.7)',
      }}
      onClick={onCancel}
    >
      <div
        style={{
          backgroundColor: 'var(--color-elevated)', border: '1px solid var(--color-subtle)',
          borderRadius: 8, padding: '32px 40px', maxWidth: 480,
          color: '#ccc', fontSize: 14, lineHeight: 1.7, textAlign: 'center',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={withBase('/images/chief_engineer.png')}
          alt=""
          style={{ height: 64, imageRendering: 'pixelated', marginBottom: 12, display: 'block', marginLeft: 'auto', marginRight: 'auto' }}
        />
        <h2 style={{ color: '#fff', margin: '0 0 16px', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          {danger && <FontAwesomeIcon icon={faTriangleExclamation} style={{ color: '#e8a33d', fontSize: 22 }} />}
          {title}
          {danger && <FontAwesomeIcon icon={faTriangleExclamation} style={{ color: '#e8a33d', fontSize: 22 }} />}
        </h2>
        <p style={{ margin: '0 0 24px' }}>{message}</p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button
            onClick={onCancel}
            style={{
              backgroundColor: 'var(--color-subtle)', border: '1px solid #4a4a4a',
              borderRadius: 4, color: '#ccc', fontSize: 14,
              padding: '10px 24px', cursor: 'pointer',
            }}
          >
            {resolvedCancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            style={{
              backgroundColor: danger ? '#6b2020' : 'var(--color-active)',
              border: `1px solid ${danger ? '#8b3030' : 'var(--color-subtle)'}`,
              borderRadius: 4, color: '#fff', fontSize: 14,
              padding: '10px 24px', cursor: 'pointer',
            }}
          >
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
