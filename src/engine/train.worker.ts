import { NNUE } from './nn';
import { parseMultiPDN, trainNN } from './nntrain';
self.onmessage = async (event: MessageEvent<{ text: string }>) => {
  try {
    const parsed = parseMultiPDN(event.data.text),
      net = new NNUE();
    const meta = await trainNN(
      net,
      parsed.samples,
      30,
      0.003,
      (progress) => self.postMessage({ t: 'progress', progress }),
      { cancelled: false },
    );
    self.postMessage({ t: 'done', meta, json: net.serialize() });
  } catch (error) {
    self.postMessage({ t: 'error', error: error instanceof Error ? error.message : String(error) });
  }
};
