require("dotenv").config();

const { MongoClient } = require("mongodb");
const fs = require("fs");

const client = new MongoClient(process.env.MONGODB_URI, {
  tls: true,
});

async function generateTrainingData() {
  try {
    await client.connect();

    const db = client.db("queuemind");

    const tokens = await db
      .collection("tokens")
      .find({})
      .sort({ createdAt: 1 })
      .toArray();

    const events = await db
      .collection("queue_events")
      .find({})
      .sort({ createdAt: 1 })
      .toArray();

    const services = await db
      .collection("services")
      .find({})
      .toArray();

    const serviceMap = {};

    for (const service of services) {
      serviceMap[service.id] = service;
    }

    const calledEvents = {};

    for (const event of events) {
      if (event.eventType === "called") {
        calledEvents[event.tokenNumber] = event.createdAt;
      }
    }

    const trainingData = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      const calledAt = calledEvents[token.tokenNumber];

      // Ignore tokens that have not been called yet.
      if (!calledAt) {
        continue;
      }
      const createdAt = new Date(token.createdAt);
const calledTime = new Date(calledAt);

const actualWait =
  (calledTime - createdAt) / (1000 * 60);

// Ignore unrealistic historical waiting times.
if (actualWait > 15) {
  continue;
}

      const service = serviceMap[token.serviceId];

      if (!service) {
        continue;
      }



      const peopleAhead = tokens.filter(
  (item) =>
    new Date(item.createdAt) < createdAt &&
    item.serviceId === token.serviceId
).length;

      const baselineWait =
        peopleAhead * service.average_service_time;

      trainingData.push({
        token_number: token.tokenNumber,
        service: service.name,
        average_service_time: service.average_service_time,
        people_ahead: peopleAhead,
        baseline_wait: Number(baselineWait.toFixed(2)),
        actual_wait: Number(actualWait.toFixed(2)),
      });
    }

    const header =
      "token_number,service,average_service_time,people_ahead,baseline_wait,actual_wait\n";

    const rows = trainingData
      .map((row) =>
        [
          row.token_number,
          `"${row.service}"`,
          row.average_service_time,
          row.people_ahead,
          row.baseline_wait,
          row.actual_wait,
        ].join(",")
      )
      .join("\n");

    fs.writeFileSync(
      "../ml/queue_training_data_real.csv",
      header + rows
    );

    console.log();
    console.log("✅ Training data generated successfully!");
    console.log();
    console.log(`Records: ${trainingData.length}`);
    console.log();
    console.log(trainingData);
    console.log();
    console.log(
      "File: ml/queue_training_data_real.csv"
    );
  } catch (error) {
    console.error("❌ Failed to generate training data:");
    console.error(error.message);
  } finally {
    await client.close();
  }
}

generateTrainingData();
