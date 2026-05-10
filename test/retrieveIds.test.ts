import {describe, it, expect, vi, beforeEach} from 'vitest';
import type {ViessmannAPIResponse, ViessmannInstallation} from '../src/interfaces.js';

/**
 * Helper that simulates the retrieveIds logic used by ViCareThermostatPlatform.
 * Extracted here to make it independently testable.
 */
async function retrieveIds(
  apiEndpoint: string,
  authorizedRequest: (url: string) => Promise<{ok: boolean; json: () => Promise<unknown>}>
): Promise<{installationId: number; gatewaySerial: string}> {
  const url = `${apiEndpoint}/equipment/installations?includeGateways=true`;
  const response = await authorizedRequest(url);
  const body = (await response.json()) as ViessmannAPIResponse<ViessmannInstallation[]>;

  if (!response.ok) {
    throw body;
  }

  const installations = body.data;

  if (!installations || installations.length === 0) {
    throw new Error('No installation data available.');
  }

  const [installation] = installations;
  const installationId = installation.id;

  if (!installation.gateways || installation.gateways.length === 0) {
    throw new Error('No gateway data available.');
  }

  const [gateway] = installation.gateways;
  const gatewaySerial = gateway.serial;

  return {installationId, gatewaySerial};
}

describe('retrieveIds (v2 API)', () => {
  const API_ENDPOINT = 'https://api.viessmann-climatesolutions.com/iot/v2';

  it('constructs the correct v2 URL with includeGateways=true', async () => {
    const mockRequest = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [
          {
            id: 12345,
            gateways: [{serial: 'GATEWAY-001', aggregatedStatus: 'Online'}],
          },
        ],
      }),
    });

    await retrieveIds(API_ENDPOINT, mockRequest);

    expect(mockRequest).toHaveBeenCalledWith(`${API_ENDPOINT}/equipment/installations?includeGateways=true`);
  });

  it('returns installationId and gatewaySerial from a v2 response', async () => {
    const mockRequest = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [
          {
            id: 42,
            gateways: [{serial: 'ABC-XYZ-123', aggregatedStatus: 'Online'}],
          },
        ],
      }),
    });

    const result = await retrieveIds(API_ENDPOINT, mockRequest);

    expect(result).toEqual({installationId: 42, gatewaySerial: 'ABC-XYZ-123'});
  });

  it('uses the first installation and first gateway when multiple are returned', async () => {
    const mockRequest = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [
          {
            id: 1,
            gateways: [
              {serial: 'FIRST-GATEWAY', aggregatedStatus: 'Online'},
              {serial: 'SECOND-GATEWAY', aggregatedStatus: 'Online'},
            ],
          },
          {
            id: 2,
            gateways: [{serial: 'OTHER-INSTALLATION-GATEWAY', aggregatedStatus: 'Online'}],
          },
        ],
        cursor: {next: 'some-cursor-token'},
      }),
    });

    const result = await retrieveIds(API_ENDPOINT, mockRequest);

    expect(result).toEqual({installationId: 1, gatewaySerial: 'FIRST-GATEWAY'});
  });

  it('throws when the response contains no installations', async () => {
    const mockRequest = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({data: []}),
    });

    await expect(retrieveIds(API_ENDPOINT, mockRequest)).rejects.toThrow('No installation data available.');
  });

  it('throws when the installation has no gateways', async () => {
    const mockRequest = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [{id: 99, gateways: []}],
      }),
    });

    await expect(retrieveIds(API_ENDPOINT, mockRequest)).rejects.toThrow('No gateway data available.');
  });

  it('throws when the installation has no gateways field', async () => {
    const mockRequest = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [{id: 99}],
      }),
    });

    await expect(retrieveIds(API_ENDPOINT, mockRequest)).rejects.toThrow('No gateway data available.');
  });

  it('propagates the API error body when the response is not ok', async () => {
    const errorBody = {
      viErrorId: 'req-123',
      statusCode: 401,
      errorType: 'UNAUTHORIZED',
      message: 'Unauthorized',
      error: 'UNAUTHORIZED',
    };

    const mockRequest = vi.fn().mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue(errorBody),
    });

    await expect(retrieveIds(API_ENDPOINT, mockRequest)).rejects.toEqual(errorBody);
  });
});
