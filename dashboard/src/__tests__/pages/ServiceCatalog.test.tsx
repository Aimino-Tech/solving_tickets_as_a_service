import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/__tests__/test-utils';
import ServiceCatalog from '@/pages/ServiceCatalog';
import type { ServiceCatalogEntry } from '@/api/types';

const mockList = vi.hoisted(() => vi.fn());
const mockCreate = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockRemove = vi.hoisted(() => vi.fn());

vi.mock('@/api/client', () => ({
  serviceCatalog: { list: mockList, create: mockCreate, update: mockUpdate, remove: mockRemove },
}));

function makeService(id: number, overrides?: Partial<ServiceCatalogEntry>): ServiceCatalogEntry {
  return {
    id,
    name: `service-${id}`,
    purpose: 'Core auth',
    repos: [{ owner: 'acme', repo: 'auth-svc' }],
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-01T10:00:00Z',
    ...overrides,
  };
}

describe('ServiceCatalog page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders services with their repos', async () => {
    mockList.mockResolvedValue({ data: [makeService(1, { name: 'billing' })] });
    renderWithProviders(<ServiceCatalog />);

    await waitFor(() => {
      expect(screen.getByText('billing')).toBeInTheDocument();
    });
    expect(screen.getByText('Core auth')).toBeInTheDocument();
    expect(screen.getByText('acme/auth-svc')).toBeInTheDocument();
  });

  it('shows empty state when no services', async () => {
    mockList.mockResolvedValue({ data: [] });
    renderWithProviders(<ServiceCatalog />);

    await waitFor(() => {
      expect(screen.getAllByText(/no services mapped yet/i).length).toBeGreaterThan(0);
    });
  });

  it('creates a service from the add form', async () => {
    mockList.mockResolvedValue({ data: [] });
    mockCreate.mockResolvedValue({ data: makeService(2, { name: 'payments' }) });
    renderWithProviders(<ServiceCatalog />);

    await waitFor(() => {
      expect(screen.getAllByText(/no services mapped yet/i).length).toBeGreaterThan(0);
    });

    await userEvent.click(screen.getByText('Add service'));
    await userEvent.type(screen.getByLabelText(/Service name/i), 'payments');
    await userEvent.type(screen.getByLabelText(/Repositories/i), 'acme/payments-svc');
    await userEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'payments', repos: [{ owner: 'acme', repo: 'payments-svc' }] }),
      );
    });
  });

  it('deletes a service via the trash button', async () => {
    mockList.mockResolvedValue({ data: [makeService(1)] });
    mockRemove.mockResolvedValue({ success: true });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithProviders(<ServiceCatalog />);

    await waitFor(() => {
      expect(screen.getByText('service-1')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByLabelText('Delete'));
    await waitFor(() => {
      expect(mockRemove).toHaveBeenCalledWith(1);
    });
    confirmSpy.mockRestore();
  });
});
