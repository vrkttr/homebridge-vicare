import {describe, it, expect, vi, beforeEach} from 'vitest';
import {RequestService} from '../src/RequestService.js';

const makeLog = () => {
  const log = vi.fn() as any;
  log.debug = vi.fn();
  log.error = vi.fn();
  log.info = vi.fn();
  log.warn = vi.fn();
  return log;
};

describe('RequestService', () => {
  let log: ReturnType<typeof makeLog>;
  let service: RequestService;

  beforeEach(() => {
    log = makeLog();
    service = new RequestService(log, 'test-client-id');
    vi.restoreAllMocks();
  });

  describe('checkForTokenExpiration', () => {
    it('throws the error body when the error is not an expired token', async () => {
      const error = {error: 'UNAUTHORIZED', statusCode: 401} as any;
      await expect(service.checkForTokenExpiration(error, 'https://example.com')).rejects.toEqual(error);
    });

    it('retries the request after refreshing an expired token', async () => {
      service.refreshToken = 'refresh-token';

      const refreshResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          access_token: 'new-token',
          expires_in: 3600,
          refresh_token: 'new-refresh-token',
          token_type: 'Bearer',
        }),
      };
      const retryResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({data: []}),
      };

      const fetchMock = vi.fn().mockResolvedValueOnce(refreshResponse).mockResolvedValueOnce(retryResponse);

      vi.stubGlobal('fetch', fetchMock);

      const expiredError = {error: 'EXPIRED TOKEN', statusCode: 401} as any;
      const result = await service.checkForTokenExpiration(expiredError, 'https://example.com/api');

      expect(result).toBe(retryResponse);
      expect(service.accessToken).toBe('new-token');
    });

    it('throws when the retry counter reaches the limit', async () => {
      service.refreshToken = 'refresh-token';

      const refreshResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          access_token: 'new-token',
          expires_in: 3600,
          refresh_token: 'new-refresh-token',
          token_type: 'Bearer',
        }),
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(refreshResponse));

      const expiredError = {error: 'EXPIRED TOKEN', statusCode: 401} as any;
      // With retries=3, the incremented value (4) exceeds the max (3), so authorizedRequest throws
      await expect(
        service.checkForTokenExpiration(expiredError, 'https://example.com/api', 'get', undefined, 3)
      ).rejects.toThrow('Could not refresh authentication token.');
    });
  });

  describe('request', () => {
    it('sends the request with the given method', async () => {
      const mockResponse = {ok: true, json: vi.fn().mockResolvedValue({})};
      const fetchMock = vi.fn().mockResolvedValue(mockResponse);
      vi.stubGlobal('fetch', fetchMock);

      await service.request('https://example.com', 'get');

      expect(fetchMock).toHaveBeenCalledWith('https://example.com', expect.objectContaining({method: 'get'}));
    });
  });

  describe('authorizedRequest', () => {
    it('adds Authorization header with bearer token', async () => {
      service.accessToken = 'my-access-token';
      const mockResponse = {ok: true, json: vi.fn().mockResolvedValue({})};
      const fetchMock = vi.fn().mockResolvedValue(mockResponse);
      vi.stubGlobal('fetch', fetchMock);

      await service.authorizedRequest('https://example.com/resource');

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((options.headers as Record<string, string>)['Authorization']).toBe('Bearer my-access-token');
    });

    it('throws immediately when max retries are exceeded', async () => {
      service.accessToken = 'token';
      const fetchMock = vi.fn().mockRejectedValue({error: 'NETWORK_ERROR'});
      vi.stubGlobal('fetch', fetchMock);

      await expect(service.authorizedRequest('https://example.com', 'get', undefined, 3)).rejects.toThrow(
        'Could not refresh authentication token.'
      );
    });
  });
});
