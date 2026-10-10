const express = require("express");
const cors = require("cors");
const supabase = require("./supabase");

const app = express();


app.use(cors());
app.use(express.json());



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
    const { data: service, error: serviceError } = await supabase
    .from("services")
    .select("id, average_service_time")
    .eq("id", serviceId)
    .single();

    if (serviceError) {
      throw serviceError;
    }

    // Find the latest token number
    const { data: latestToken, error: latestTokenError } = await supabase
      .from("tokens")
      .select("token_number")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestTokenError) {
      throw latestTokenError;
    }

    let nextNumber = 101;

    if (latestToken) {
      nextNumber = parseInt(latestToken.token_number.substring(1)) + 1;
    }

    const token = `A${nextNumber}`;

    // Insert token into PostgreSQL
    const { data: newToken, error: tokenError } = await supabase
      .from("tokens")
      .insert({
        token_number: token,
        service_id: service.id,
        status: "waiting",
      })
      .select()
      .single();

    if (tokenError) {
      throw tokenError;
    }

    // Count people currently waiting
    const { count, error: countError } = await supabase
      .from("tokens")
      .select("*", { count: "exact", head: true })
      .eq("status", "waiting");

    if (countError) {
      throw countError;
    }

    const position = count;
    const peopleAhead = position - 1;
    const estimatedWait =
      peopleAhead * service.average_service_time;

    // Record queue event
    const { error: eventError } = await supabase
      .from("queue_events")
      .insert({
        token_id: newToken.id,
        event_type: "created",
      });

    if (eventError) {
      throw eventError;
    }

    res.json({
      success: true,
      token: token,
      position: position,
      peopleAhead: peopleAhead,
      estimatedWait: estimatedWait,
    });

  } catch (error) {
    console.error("Token creation error:", error);

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
    const { data: queue, error: queueError } = await supabase
      .from("tokens")
      .select(`
        id,
        token_number,
        status,
        created_at,
        served_at,
        service_id,
        services (
          name,
          average_service_time
        )
      `)
      .eq("status", "waiting")
      .order("created_at", { ascending: true });

    if (queueError) {
      throw queueError;
    }

    // Get the token currently being served
    const { data: servingToken, error: servingError } = await supabase
      .from("tokens")
      .select("id, token_number, status")
      .eq("status", "serving")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (servingError) {
      throw servingError;
    }

    // Calculate estimated waiting time
    let estimatedWait = 0;

    if (queue.length > 0) {
      estimatedWait = queue.reduce((total, token) => {
        return total + token.services.average_service_time;
      }, 0);
    }

    res.json({
      success: true,
      queueLength: queue.length,
      queue: queue,
      nowServing: servingToken ? servingToken.token_number : null,
      estimatedWait: estimatedWait,
    });

  } catch (error) {
    console.error("Queue fetch error:", error);

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
    const { data: token, error: tokenError } = await supabase
      .from("tokens")
      .select(`
        id,
        token_number,
        status,
        created_at,
        served_at,
        service_id,
        services (
          name,
          average_service_time
        )
      `)
      .eq("token_number", tokenNumber)
      .single();

    if (tokenError) {
      return res.status(404).json({
        success: false,
        message: "Token not found.",
      });
    }

    // If token is no longer waiting
    if (token.status !== "waiting") {
      return res.json({
        success: true,
        token: token.token_number,
        status: token.status,
        position: null,
        peopleAhead: 0,
        estimatedWait: 0,
      });
    }

    // Get all waiting tokens ahead of this token
    const { data: waitingTokens, error: queueError } = await supabase
      .from("tokens")
      .select(`
        id,
        token_number,
        created_at,
        service_id,
        services (
          average_service_time
        )
      `)
      .eq("status", "waiting")
      .order("created_at", { ascending: true });

    if (queueError) {
      throw queueError;
    }

    // Find this token's position
    const position = waitingTokens.findIndex(
      (item) => item.id === token.id
    ) + 1;

    const peopleAhead = position - 1;

    // Calculate waiting time based on people ahead
    const estimatedWait = waitingTokens
      .slice(0, position - 1)
      .reduce((total, item) => {
        return total + item.services.average_service_time;
      }, 0);

    res.json({
      success: true,
      token: token.token_number,
      service: token.services.name,
      status: token.status,
      position: position,
      peopleAhead: peopleAhead,
      estimatedWait: estimatedWait,
    });

  } catch (error) {
    console.error("Token status error:", error);

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
const { data: servingToken, error: servingError } = await supabase
  .from("tokens")
  .select("id, token_number")
  .eq("status", "serving")
  .limit(1)
  .maybeSingle();

if (servingError) {
  throw servingError;
}

if (servingToken) {
  return res.status(400).json({
    success: false,
    message: `${servingToken.token_number} is still being served.`,
  });
}
    // Find the first waiting token
    const { data: nextToken, error: findError } = await supabase
      .from("tokens")
      .select("id, token_number")
      .eq("status", "waiting")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (findError) {
      throw findError;
    }

    if (!nextToken) {
      return res.status(400).json({
        success: false,
        message: "No customers are waiting.",
      });
    }

    // Mark token as served
    // Mark token as currently being served
const { error: updateError } = await supabase
  .from("tokens")
  .update({
    status: "serving",
  })
  .eq("id", nextToken.id);

    if (updateError) {
      throw updateError;
    }

    // Record queue event
    const { error: eventError } = await supabase
      .from("queue_events")
      .insert({
        token_id: nextToken.id,
        event_type: "served",
      });

    if (eventError) {
      throw eventError;
    }

    // Get remaining queue
    const { data: remainingQueue, error: queueError } = await supabase
      .from("tokens")
      .select("id, token_number, status, created_at")
      .eq("status", "waiting")
      .order("created_at", { ascending: true });

    if (queueError) {
      throw queueError;
    }

    res.json({
      success: true,
      message: `${nextToken.token_number} is now being served.`,
      servedToken: nextToken.token_number,
      remainingQueue: remainingQueue.length,
      queue: remainingQueue,
    });

  } catch (error) {
    console.error("Serve next error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to serve next customer.",
    });
  }
});
// -------------------------
// Complete Current Customer
// -------------------------

app.post("/api/queue/complete", async (req, res) => {
  try {
    // Find the currently serving token
    const { data: servingToken, error: findError } = await supabase
      .from("tokens")
      .select("id, token_number")
      .eq("status", "serving")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (findError) {
      throw findError;
    }

    if (!servingToken) {
      return res.status(400).json({
        success: false,
        message: "No customer is currently being served.",
      });
    }

    // Mark the token as served
    const { error: updateError } = await supabase
      .from("tokens")
      .update({
        status: "served",
        served_at: new Date().toISOString(),
      })
      .eq("id", servingToken.id);

    if (updateError) {
      throw updateError;
    }

    // Record queue event
    const { error: eventError } = await supabase
      .from("queue_events")
      .insert({
        token_id: servingToken.id,
        event_type: "served",
      });

    if (eventError) {
      throw eventError;
    }

    res.json({
      success: true,
      message: `${servingToken.token_number} has been completed.`,
      completedToken: servingToken.token_number,
    });

  } catch (error) {
    console.error("Complete customer error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to complete customer.",
    });
  }
});

// -------------------------
// Start Server
// -------------------------

const PORT = 5000;

app.listen(PORT, () => {
  console.log(`QueueMind AI backend running on http://localhost:${PORT}`);
});