// Clients for the R20b client check. Both use the stock @x402/fetch 2.28.0 wrapper over @x402/core's x402Client, with
// a loopback test signer for the exact scheme (a well-formed payload with a fresh nonce or transaction each time it is
// asked to pay; nothing holds value). The application's retry policy is the same: wait 1 s for the paid call, then retry once.
//
//   control            the upstream payment-identifier client pattern: one payment id per logical request, appended
//                      in onBeforePaymentCreation, so the re-signed retry carries the same key
//   resign_on_timeout  the same client without the payment id: the retry re-signs a fresh payment with no key
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { appendPaymentIdentifierToExtensions, generatePaymentId } from "@x402/extensions/payment-identifier";
import { freshPayload } from "../src/retry.js";

export type ClientFault = "" | "resign_on_timeout";

export function retryingClient(network: string, fault: ClientFault = "", timeoutMs = 1000) {
  return async (url: string): Promise<Response> => {
    const client = new x402Client().register(network as `${string}:${string}`, {
      scheme: "exact",
      createPaymentPayload: async (x402Version: number, requirements: any) =>
        ({ x402Version, payload: freshPayload(requirements) }),
    } as any);
    // The test signer has no asset table, so the price's asset reads as non-default to the spend controls.
    client.setSpendControls({ allowedAssets: true });
    if (fault === "") {
      const id = generatePaymentId();
      client.onBeforePaymentCreation(async ({ paymentRequired }) => {
        if (paymentRequired.extensions) appendPaymentIdentifierToExtensions(paymentRequired.extensions, id);
      });
    }
    // The application's timeout is on the paid call: the one that waits for settlement. A first attempt that gives
    // up, then one retry with a generous timeout.
    let attempt = 0;
    const timed: typeof fetch = (input, init) => {
      const paid = input instanceof Request && input.headers.has("payment-signature");
      if (!paid) return fetch(input, init);
      const ms = attempt++ === 0 ? timeoutMs : 15_000;
      return fetch(input, { ...init, signal: AbortSignal.timeout(ms) });
    };
    const pay = wrapFetchWithPayment(timed, client);
    try {
      return await pay(url);
    } catch {
      return await pay(url);
    }
  };
}
