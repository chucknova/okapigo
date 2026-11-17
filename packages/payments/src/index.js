// @ts-check
/**
 * @okapigo/payments: payment providers behind one interface.
 *
 *   const provider = createPaymentProvider({ provider: 'paystack', paystackSecretKey, baseUrl })
 *
 * Callers (the API now, the workers from 10c) only use the PaymentProvider methods, so
 * switching between the simulator and Paystack is a config change, nothing else.
 */
import { createSimulatorProvider } from './simulator.js';
import { createPaystackProvider } from './paystack.js';

export { createSimulatorProvider, simulatedFeeKobo } from './simulator.js';
export { createPaystackProvider } from './paystack.js';
export { ProviderError, LiveKeyError } from './provider.js';

/**
 * @param {{ provider: 'simulator' | 'paystack', paystackSecretKey?: string, baseUrl: string }} config
 * @returns {import('./provider.js').PaymentProvider}
 */
export function createPaymentProvider({ provider, paystackSecretKey, baseUrl }) {
  if (provider === 'paystack') {
    return createPaystackProvider({ secretKey: /** @type {string} */ (paystackSecretKey) });
  }
  return createSimulatorProvider({ baseUrl });
}
