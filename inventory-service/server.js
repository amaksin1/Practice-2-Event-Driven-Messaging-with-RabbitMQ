const { connectWithRetry, getRetryCount } = require('/app/shared/rabbit');

const QUEUE = 'inventory.queue';
const RESULTS_EXCHANGE = 'results.inventory';
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES) || 3;
const FAIL_RATE = parseInt(process.env.INVENTORY_FAIL_RATE) || 10;

async function main() {
  const { connection, channel } = await connectWithRetry(process.env.RABBITMQ_URL);
  await channel.prefetch(1);

  console.log(`[Inventory] Consuming from ${QUEUE}, fail rate: ${FAIL_RATE}%`);

  channel.consume(QUEUE, async (msg) => {
    if (!msg) return;

    const order = JSON.parse(msg.content.toString());
    const correlationId = msg.properties.headers?.correlationId;
    const retryCount = getRetryCount(msg);

    console.log(`[Inventory] Processing ${correlationId} (attempt ${retryCount + 1})`);

    try {
      if (Math.random() * 100 < FAIL_RATE) {
        throw new Error('Inventory check failed');
      }

      channel.ack(msg);
      channel.publish(
        RESULTS_EXCHANGE,
        '',
        Buffer.from(
          JSON.stringify({
            correlationId,
            source: 'inventory',
            status: 'success',
            timestamp: new Date().toISOString(),
            details: {
              message: 'Inventory validated successfully',
              orderId: order?.orderId
            }
          })
        ),
        {
          headers: { correlationId },
          contentType: 'application/json'
        }
      );

      return;
    } catch (err) {
      if (retryCount >= MAX_RETRIES - 1) {
        channel.publish(process.env.DLQ_EXCHANGE, '', msg.content, {
          headers: msg.properties.headers
        });
        channel.ack(msg);
        console.log(`[Inventory] → DLQ after ${retryCount + 1} attempts: ${err.message}`);
      } else {
        channel.nack(msg, false, false);
        console.log(`[Inventory] → Retry (attempt ${retryCount + 1}): ${err.message}`);
      }
    }
  });
}

main().catch(console.error);
