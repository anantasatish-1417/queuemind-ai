const { spawn } = require("child_process");
const path = require("path");
const express = require("express");
const cors = require("cors");

const { MongoClient } = require("mongodb");

const mongoClient = new MongoClient(process.env.MONGODB_URI, {
  tls: true,
  serverSelectionTimeoutMS: 10000
});
const mongoDb = mongoClient.db("queuemind");

const app = express();


app.use(cors());
app.use(express.json());
function predictWaitTime(averageServiceTime, peopleAhead, baselineWait) {
  return new Promise((resolve, reject) => {
    const pythonScript = path.join(__dirname, "..", "ml", "predict.py");

const python = spawn("python", [
  pythonScript,
  averageServiceTime.toString(),
  peopleAhead.toString(),
  baselineWait.toString(),
]);

    let output = "";
    let errorOutput = "";

    python.stdout.on("data", (data) => {
      output += data.toString();
    });

    python.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    python.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(errorOutput));
        return;
      }

      resolve(parseFloat(output.trim()));
    });
  });
}
// ----------------------
// ML Prediction Test Route
// ----------------------



// -------------------------
// Home Route
// -------------------------

app.get("/", (req, res) => {
  res.json({
    message: "QueueMind AI Backend is running 🚀",
  });
});

// -------------------------
// Health Check
// -------------------------

app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    service: "QueueMind AI",
    timestamp: new Date().toISOString(),
  });
});

// -------------------------
// Take a Token
// -------------------------

app.post("/api/tokens", async (req, res) => {
  try {
    const { serviceId } = req.body;

    if (!serviceId) {
      return res.status(400).json({
        success: false,
        message: "serviceId is required.",
      });
    }

    // Find service in MongoDB
    const service = await mongoDb.collection("services").findOne({
      id: serviceId,
    });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not found.",
      });
    }

    // Find latest token
    const latestToken = await mongoDb
      .collection("tokens")
      .find({})
      .sort({ tokenNumberValue: -1 })
      .limit(1)
      .next();

    let nextNumber = 101;

    if (latestToken) {
      nextNumber = latestToken.tokenNumberValue + 1;
    }

    const token = `A${nextNumber}`;

    const newToken = {
      tokenNumber: token,
      tokenNumberValue: nextNumber,
      serviceId: service.id,
      status: "waiting",
      createdAt: new Date(),
      servedAt: null,
    };

    const result = await mongoDb
      .collection("tokens")
      .insertOne(newToken);

    // Count waiting tokens
    const waitingCount = await mongoDb
      .collection("tokens")
      .countDocuments({
        status: "waiting",
      });

    const position = waitingCount;
    const peopleAhead = position - 1;

    const estimatedWait =
      peopleAhead * service.average_service_time;

    // Record queue event
    await mongoDb.collection("queue_events").insertOne({
      tokenId: result.insertedId,
      tokenNumber: token,
      eventType: "created",
      createdAt: new Date(),
    });

    res.json({
      success: true,
      token: token,
      position: position,
      peopleAhead: peopleAhead,
      estimatedWait: estimatedWait,
    });
  } catch (error) {
    console.error("MongoDB token creation error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to create token.",
    });
  }
});

// -------------------------
// View Current Queue
// -------------------------

app.get("/api/queue", async (req, res) => {
  try {
    // Get waiting customers
    const queue = await mongoDb
      .collection("tokens")
      .find({ status: "waiting" })
      .sort({ createdAt: 1 })
      .toArray();

    // Get services for queue tokens
    for (const token of queue) {
      const service = await mongoDb
        .collection("services")
        .findOne({ id: token.serviceId });

      token.service = service
        ? {
            name: service.name,
            average_service_time: service.average_service_time,
          }
        : null;
    }

    // Get the token currently being served
    const servingToken = await mongoDb
      .collection("tokens")
      .findOne(
        { status: "serving" },
        { sort: { createdAt: 1 } }
      );

    // Calculate estimated waiting time
    let estimatedWait = 0;

    if (queue.length > 0) {
      estimatedWait = queue.reduce((total, token) => {
        return (
          total +
          (token.service
            ? token.service.average_service_time
            : 0)
        );
      }, 0);
    }

    res.json({
      success: true,
      queueLength: queue.length,
      queue: queue,
      nowServing: servingToken
        ? servingToken.tokenNumber
        : null,
      estimatedWait: estimatedWait,
    });

  } catch (error) {
    console.error("MongoDB queue fetch error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch queue.",
    });
  }
});
  // -------------------------
// Get Token Status
// -------------------------
app.get("/api/tokens/:tokenNumber", async (req, res) => {
  try {
    const { tokenNumber } = req.params;

    // Find the requested token
    const token = await mongoDb
      .collection("tokens")
      .findOne({
        tokenNumber: tokenNumber,
      });

    if (!token) {
      return res.status(404).json({
        success: false,
        message: "Token not found.",
      });
    }

    // If token is no longer waiting
    if (token.status !== "waiting") {
      return res.json({
        success: true,
        token: token.tokenNumber,
        status: token.status,
        position: null,
        peopleAhead: 0,
        estimatedWait: 0,
      });
    }

    // Get all waiting tokens
    const waitingTokens = await mongoDb
      .collection("tokens")
      .find({
        status: "waiting",
      })
      .sort({
        createdAt: 1,
      })
      .toArray();

    // Find this token's position
    const position =
      waitingTokens.findIndex(
        (item) => item.tokenNumber === token.tokenNumber
      ) + 1;

    const peopleAhead = position - 1;

    // Calculate estimated waiting time
    let estimatedWait = 0;

    for (const item of waitingTokens.slice(0, position - 1)) {
      const service = await mongoDb
        .collection("services")
        .findOne({
          id: item.serviceId,
        });

      if (service) {
        estimatedWait += service.average_service_time;
      }
    }

    // Find current token's service
    const service = await mongoDb
      .collection("services")
      .findOne({
        id: token.serviceId,
      });

    res.json({
      success: true,
      token: token.tokenNumber,
      service: service ? service.name : null,
      status: token.status,
      position: position,
      peopleAhead: peopleAhead,
      estimatedWait: estimatedWait,
    });

  } catch (error) {
    console.error("MongoDB token status error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to get token status.",
    });
  }
});
// -------------------------
// Serve Next Customer
// -------------------------

app.post("/api/queue/serve-next", async (req, res) => {
  try {
    // Check if a customer is already being served
    const servingToken = await mongoDb
      .collection("tokens")
      .findOne({
        status: "serving",
      });

    if (servingToken) {
      return res.status(400).json({
        success: false,
        message: `${servingToken.tokenNumber} is still being served.`,
      });
    }

    // Find the first waiting token
    // Get all waiting tokens
const waitingTokens = await mongoDb
  .collection("tokens")
  .find({
    status: "waiting",
  })
  .sort({
    createdAt: 1,
  })
  .toArray();

if (waitingTokens.length === 0) {
  return res.status(400).json({
    success: false,
    message: "No customers are waiting.",
  });
}

// Calculate AI priority for each waiting customer
const recommendations = [];

for (const token of waitingTokens) {
  const service = await mongoDb
    .collection("services")
    .findOne({
      id: token.serviceId,
    });

  if (!service) {
    continue;
  }

  const peopleAhead = waitingTokens.filter(
    (item) =>
      new Date(item.createdAt) < new Date(token.createdAt)
  ).length;

  const baselineWait =
    peopleAhead * service.average_service_time;

  const predictedWait = await predictWaitTime(
    service.average_service_time,
    peopleAhead,
    baselineWait
  );

  const waitingMinutes =
    (Date.now() - new Date(token.createdAt).getTime()) /
    (1000 * 60);

  const priorityScore =
    predictedWait * 1.5 +
    waitingMinutes * 2 +
    peopleAhead * 0.5 -
    service.average_service_time * 0.2;

  recommendations.push({
    token,
    priorityScore,
  });
}

// Select the highest-priority customer
recommendations.sort(
  (a, b) => b.priorityScore - a.priorityScore
);

const nextToken = recommendations[0].token;

    // Mark token as currently being served
    await mongoDb
      .collection("tokens")
      .updateOne(
        { _id: nextToken._id },
        {
          $set: {
            status: "serving",
          },
        }
      );

    // Record queue event
    await mongoDb.collection("queue_events").insertOne({
      tokenId: nextToken._id,
      tokenNumber: nextToken.tokenNumber,
      eventType: "called",
      createdAt: new Date(),
    });

    // Get remaining queue
    const remainingQueue = await mongoDb
      .collection("tokens")
      .find({
        status: "waiting",
      })
      .sort({
        createdAt: 1,
      })
      .toArray();

    res.json({
      success: true,
      message: `${nextToken.tokenNumber} is now being served.`,
      servedToken: nextToken.tokenNumber,
      remainingQueue: remainingQueue.length,
      queue: remainingQueue,
    });

  } catch (error) {
    console.error("MongoDB serve next error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to serve next customer.",
    });
  }
});
// -------------------------
// Queue Analytics
// -------------------------

app.get("/api/analytics", async (req, res) => {
  try {
    const tokens = await mongoDb
      .collection("tokens")
      .find({})
      .toArray();

    const servedTokens = tokens.filter(
      (token) => token.status === "served"
    );

    const calledEvents = await mongoDb
      .collection("queue_events")
      .find({
        eventType: "called",
      })
      .toArray();

    const calledMap = {};

    for (const event of calledEvents) {
      calledMap[event.tokenNumber] = new Date(event.createdAt);
    }

    let totalWaitTime = 0;
    let validWaits = 0;

    for (const token of servedTokens) {
      const calledAt = calledMap[token.tokenNumber];

      if (!calledAt) {
        continue;
      }

      const createdAt = new Date(token.createdAt);

      const waitTime =
        (calledAt - createdAt) / (1000 * 60);

      if (waitTime >= 0) {
        totalWaitTime += waitTime;
        validWaits++;
      }
    }

    const averageWaitTime =
      validWaits > 0
        ? totalWaitTime / validWaits
        : 0;

    res.json({
      success: true,
      totalCustomers: tokens.length,
      customersServed: servedTokens.length,
      customersWaiting: tokens.filter(
        (token) => token.status === "waiting"
      ).length,
      averageWaitTime: Number(
        averageWaitTime.toFixed(2)
      ),
    });
  } catch (error) {
    console.error("Analytics error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to calculate analytics.",
    });
  }
});
// -------------------------
// Service-wise Analytics
// -------------------------

app.get("/api/analytics/services", async (req, res) => {
  try {
    const tokens = await mongoDb
      .collection("tokens")
      .find({})
      .toArray();

    const services = await mongoDb
      .collection("services")
      .find({})
      .toArray();

    const calledEvents = await mongoDb
      .collection("queue_events")
      .find({
        eventType: "called",
      })
      .toArray();

    const calledMap = {};

    for (const event of calledEvents) {
      calledMap[event.tokenNumber] = new Date(event.createdAt);
    }

    const serviceAnalytics = [];

    for (const service of services) {
      const serviceTokens = tokens.filter(
        (token) => token.serviceId === service.id
      );

      const servedTokens = serviceTokens.filter(
        (token) => token.status === "served"
      );

      let totalWaitTime = 0;
      let validWaits = 0;

      for (const token of servedTokens) {
        const calledAt = calledMap[token.tokenNumber];

        if (!calledAt) {
          continue;
        }

        const createdAt = new Date(token.createdAt);

        const waitTime =
          (calledAt - createdAt) / (1000 * 60);

        if (waitTime >= 0) {
          totalWaitTime += waitTime;
          validWaits++;
        }
      }

      const averageWaitTime =
        validWaits > 0
          ? totalWaitTime / validWaits
          : 0;

      serviceAnalytics.push({
        service: service.name,
        totalCustomers: serviceTokens.length,
        customersServed: servedTokens.length,
        customersWaiting: serviceTokens.filter(
          (token) => token.status === "waiting"
        ).length,
        averageWaitTime: Number(
          averageWaitTime.toFixed(2)
        ),
      });
    }

    res.json({
      success: true,
      services: serviceAnalytics,
    });
  } catch (error) {
    console.error(
      "Service analytics error:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Failed to calculate service analytics.",
    });
  }
});
// -------------------------
// AI Queue Optimization
// -------------------------

app.get("/api/queue/optimization", async (req, res) => {
  try {
    // Get all waiting tokens
    const waitingTokens = await mongoDb
      .collection("tokens")
      .find({
        status: "waiting",
      })
      .sort({
        createdAt: 1,
      })
      .toArray();

    if (waitingTokens.length === 0) {
      return res.json({
        success: true,
        recommendation: null,
        message: "No customers are waiting.",
      });
    }

    // Calculate priority for each token
    const recommendations = [];

    for (const token of waitingTokens) {
      const service = await mongoDb
        .collection("services")
        .findOne({
          id: token.serviceId,
        });

      if (!service) {
        continue;
      }

      const peopleAhead = waitingTokens.filter(
        (item) =>
          new Date(item.createdAt) < new Date(token.createdAt)
      ).length;

      const baselineWait =
        peopleAhead * service.average_service_time;

      const predictedWait = await predictWaitTime(
        service.average_service_time,
        peopleAhead,
        baselineWait
      );

      // Priority score:
      // Higher waiting time = higher priority
      const waitingMinutes =
        (Date.now() - new Date(token.createdAt).getTime()) /
        (1000 * 60);
const priorityScore =
  predictedWait * 1.5 +
  waitingMinutes * 2 +
  peopleAhead * 0.5 -
  service.average_service_time * 0.2;

      recommendations.push({
        tokenNumber: token.tokenNumber,
        service: service.name,
        peopleAhead: peopleAhead,
        baselineWait: Number(baselineWait.toFixed(2)),
        predictedWait: predictedWait,
        waitingMinutes: Number(waitingMinutes.toFixed(2)),
        priorityScore: Number(priorityScore.toFixed(2)),
      });
    }

    // Highest priority should be served first
    recommendations.sort(
      (a, b) => b.priorityScore - a.priorityScore
    );

    const recommended = recommendations[0];

    res.json({
      success: true,
      recommendation: {
        token: recommended.tokenNumber,
        service: recommended.service,
        predictedWait: recommended.predictedWait,
        waitingMinutes: recommended.waitingMinutes,
        priorityScore: recommended.priorityScore,
        reason: `Highest priority based on waiting time and queue length.`,
      },
      candidates: recommendations,
    });

  } catch (error) {
    console.error("AI queue optimization error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to calculate queue optimization.",
    });
  }
});
// -------------------------
// Complete Current Customer
// -------------------------

app.post("/api/queue/complete", async (req, res) => {
  try {
    // Find the currently serving token
    const servingToken = await mongoDb
      .collection("tokens")
      .findOne(
        { status: "serving" },
        { sort: { createdAt: 1 } }
      );

    if (!servingToken) {
      return res.status(400).json({
        success: false,
        message: "No customer is currently being served.",
      });
    }

    // Mark the token as served
    await mongoDb
      .collection("tokens")
      .updateOne(
        { _id: servingToken._id },
        {
          $set: {
            status: "served",
            servedAt: new Date(),
          },
        }
      );

    // Record queue event
    await mongoDb.collection("queue_events").insertOne({
      tokenId: servingToken._id,
      tokenNumber: servingToken.tokenNumber,
      eventType: "served",
      createdAt: new Date(),
    });

    res.json({
      success: true,
      message: `${servingToken.tokenNumber} has been completed.`,
      completedToken: servingToken.tokenNumber,
    });

  } catch (error) {
    console.error("MongoDB complete customer error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to complete customer.",
    });
  }
});
// -------------------------
// Predict Waiting Time
// -------------------------

app.get("/api/predict/:tokenNumber", async (req, res) => {
  try {
    const { tokenNumber } = req.params;

    // Find the requested token
    const token = await mongoDb
      .collection("tokens")
      .findOne({
        tokenNumber: tokenNumber,
      });

    if (!token) {
      return res.status(404).json({
        success: false,
        message: "Token not found.",
      });
    }

    // If token is no longer waiting
    if (token.status !== "waiting") {
      return res.json({
        success: true,
        token: token.tokenNumber,
        status: token.status,
        predictedWait: 0,
        message: "Customer is not waiting in the queue.",
      });
    }

    // Find the token's service
    const tokenService = await mongoDb
      .collection("services")
      .findOne({
        id: token.serviceId,
      });

    if (!tokenService) {
      return res.status(404).json({
        success: false,
        message: "Service not found.",
      });
    }

    // Get all waiting tokens
    const waitingTokens = await mongoDb
      .collection("tokens")
      .find({
        status: "waiting",
      })
      .sort({
        createdAt: 1,
      })
      .toArray();

    const position =
      waitingTokens.findIndex(
        (item) => item.tokenNumber === token.tokenNumber
      ) + 1;

    const peopleAhead = position - 1;

    // Calculate baseline waiting time
    let baselineWait = 0;

    for (const item of waitingTokens.slice(0, peopleAhead)) {
      const service = await mongoDb
        .collection("services")
        .findOne({
          id: item.serviceId,
        });

      if (service) {
        baselineWait += service.average_service_time;
      }
    }

    // Use ML model to predict waiting time
    const predictedWait = await predictWaitTime(
      tokenService.average_service_time,
      peopleAhead,
      baselineWait
    );

    res.json({
      success: true,
      token: token.tokenNumber,
      service: tokenService.name,
      status: token.status,
      position: position,
      peopleAhead: peopleAhead,
      baselineWait: baselineWait,
      predictedWait: predictedWait,
      predictionType: "machine-learning",
    });

  } catch (error) {
    console.error("MongoDB prediction error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to predict waiting time.",
    });
  }
});
// -------------------------
// Start Server
// -------------------------

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await mongoClient.connect();

    console.log("✅ MongoDB connected successfully!");
    console.log("✅ Database selected: queuemind");

    app.listen(PORT, () => {
      console.log(`QueueMind AI backend running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("❌ MongoDB connection failed:");
    console.error(error.message);

    process.exit(1);
  }
}

startServer();