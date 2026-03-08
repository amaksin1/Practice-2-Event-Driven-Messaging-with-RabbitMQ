const express = require('express');
 const { v4: uuidv4 } = require('uuid');
 const { connectWithRetry } = require('/app/shared/rabbit');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const ORDERS_EXCHANGE = 'orders.exchange';
const ordersByCorrelationId = new Map();

function createOrderId(correlationId) {
  return `ord-${String(correlationId).slice(0, 8)}`;
}

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.post('/orders', async (req, res) => {
  const correlationId = uuidv4();
  const orderId = createOrderId(correlationId);
  const timestamp = new Date().toISOString();

  const enrichedOrder = {
    ...req.body,
    orderId,
    correlationId,
    timestamp
  };

  try {
    if (!app.locals.rabbitChannel) {
      res.status(503).json({ error: 'RabbitMQ channel not ready' });
      return;
    }

    app.locals.rabbitChannel.publish(
      ORDERS_EXCHANGE,
      '',
      Buffer.from(JSON.stringify(enrichedOrder)),
      {
        headers: { correlationId },
        contentType: 'application/json'
      }
    );

    ordersByCorrelationId.set(correlationId, enrichedOrder);
    res.status(201).json({ correlationId, status: 'accepted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/orders/:correlationId', (req, res) => {
  const order = ordersByCorrelationId.get(req.params.correlationId);
  if (!order) {
    res.sendStatus(404);
    return;
  }
  res.status(200).json(order);
});

async function main() {
  const { connection, channel } = await connectWithRetry(process.env.RABBITMQ_URL);
  app.locals.rabbitConnection = connection;
  app.locals.rabbitChannel = channel;

  app.listen(PORT, () => {
    console.log(`[Order] Listening on port ${PORT}`);
  });
}

main().catch(console.error);
