import { defineIndexer } from "@apibara/indexer";
import { useLogger } from "@apibara/indexer/plugins";
import { StarknetStream } from "@apibara/starknet";

export default defineIndexer(StarknetStream)({
  streamUrl: "https://starknet.preview.apibara.org",
  startingCursor: {
    orderKey: 900_000n,
  },
  filter: {
    events: [
      {
        address:
          "0x028d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a",
      },
    ],
  },
  async transform({ block }) {
    const logger = useLogger();
    const { events, header } = block;
    logger.log(`Block number ${header?.blockNumber}`);
    for (const event of events) {
      logger.log(`Event ${event.eventIndex} tx=${event.transactionHash}`);
    }
  },
});
