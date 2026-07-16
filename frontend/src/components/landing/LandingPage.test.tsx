import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LandingPage } from './LandingPage';

const baseProps = {
  backendWakeUrl: 'http://localhost:5174/healthz',
  code: '',
  creating: false,
  error: '',
  joining: false,
  notice: '',
  onCodeChange: vi.fn(),
  onCreate: vi.fn(),
  onJoin: vi.fn(),
  realtimeWakeUrl: 'https://realtime.example/health'
};

describe('LandingPage', () => {
  it('keeps the room creation and join actions connected', () => {
    const onCodeChange = vi.fn();
    const onCreate = vi.fn();
    const onJoin = vi.fn();
    render(<LandingPage {...baseProps} onCodeChange={onCodeChange} onCreate={onCreate} onJoin={onJoin} />);

    fireEvent.click(screen.getByRole('button', { name: 'Create Pear Room' }));
    expect(onCreate).toHaveBeenCalledOnce();

    fireEvent.change(screen.getByLabelText('Enter Room Code'), { target: { value: 'ABC123' } });
    expect(onCodeChange).toHaveBeenCalledWith('ABC123');
    fireEvent.click(screen.getByRole('button', { name: 'Join Pear Room' }));
    expect(onJoin).toHaveBeenCalledOnce();
  });

  it('presents the create and join forms without redundant shortcut tabs', () => {
    render(<LandingPage {...baseProps} />);

    expect(screen.queryByRole('navigation', { name: 'Room action shortcuts' })).not.toBeInTheDocument();
    expect(screen.getByText('Start a new room')).toBeInTheDocument();
    expect(screen.getByLabelText('Enter Room Code')).toBeInTheDocument();
  });

  it('exposes compact service wake-up links', () => {
    render(<LandingPage {...baseProps} />);

    expect(screen.getByRole('link', { name: baseProps.backendWakeUrl })).toHaveAttribute('href', baseProps.backendWakeUrl);
    expect(screen.getByRole('link', { name: baseProps.realtimeWakeUrl })).toHaveAttribute('href', baseProps.realtimeWakeUrl);
  });

  it('locks both room actions while an entry request is running', () => {
    const { rerender } = render(<LandingPage {...baseProps} creating />);
    expect(screen.getByRole('button', { name: 'Preparing your room…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Join Pear Room' })).toBeDisabled();

    rerender(<LandingPage {...baseProps} joining />);
    expect(screen.getByRole('button', { name: 'Create Pear Room' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Joining…' })).toBeDisabled();
  });

  it('announces room notices and errors', () => {
    render(<LandingPage {...baseProps} error="That room is unavailable." notice="The room is waking up." />);

    expect(screen.getByText('The room is waking up.')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('alert')).toHaveTextContent('That room is unavailable.');
  });
});
