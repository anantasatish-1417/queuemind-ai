import { useEffect, useState } from "react";
import "./App.css";

function App() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [tokenStatus, setTokenStatus] = useState("waiting");
  const [selectedService, setSelectedService] = useState("general");
  const serviceNames: Record<string, string> = {
  general: "General Consultation",
  billing: "Billing & Payments",
  documents: "Document Services",
};
  const [position, setPosition] = useState<number | null>(null);
  const [peopleAhead, setPeopleAhead] = useState<number | null>(null);
  const [estimatedWait, setEstimatedWait] = useState<number | null>(null);
  const [predictedWait, setPredictedWait] = useState<number | null>(null);
  const [queueLength, setQueueLength] = useState(0);
  const [analytics, setAnalytics] = useState<any>(null);
  const [serviceAnalytics, setServiceAnalytics] = useState<any[]>([]);
  const [aiRecommendation, setAiRecommendation] = useState<any>(null);
  const [liveNowServing, setLiveNowServing] = useState<string | null>(null);
  const [liveEstimatedWait, setLiveEstimatedWait] = useState(0);
  const [loading, setLoading] = useState(false);

  // Get current queue from backend
 const fetchQueue = async () => {
  try {
    const response = await fetch(
      "http://localhost:5000/api/queue"
    );

    const data = await response.json();

    setQueueLength(data.queueLength);
    setLiveNowServing(data.nowServing);
    setLiveEstimatedWait(data.estimatedWait);

    // Fetch AI queue recommendation
    const optimizationResponse = await fetch(
      "http://localhost:5000/api/queue/optimization"
    );

    const optimizationData = await optimizationResponse.json();

    if (optimizationData.success) {
      setAiRecommendation(
        optimizationData.recommendation
      );
    }
    const analyticsResponse = await fetch(
  "http://localhost:5000/api/analytics"
);

const analyticsData = await analyticsResponse.json();

if (analyticsData.success) {
  setAnalytics(analyticsData);
}
const serviceAnalyticsResponse = await fetch(
  "http://localhost:5000/api/analytics/services"
);

const serviceAnalyticsData =
  await serviceAnalyticsResponse.json();

if (serviceAnalyticsData.success) {
  setServiceAnalytics(serviceAnalyticsData.services);
}
  } catch (error) {
    console.error("Failed to fetch queue:", error);
  }
};


  // Fetch queue when page loads
  useEffect(() => {
  fetchQueue();

  const interval = setInterval(() => {
    fetchQueue();
  }, 5000);

  return () => clearInterval(interval);
}, []);
useEffect(() => {
  if (!token) return;

  const fetchTokenStatus = async () => {
    try {
      const response = await fetch(
        `http://localhost:5000/api/tokens/${token}`
      );

      const data = await response.json();

      if (data.success) {
        // Update the user's token information in real time
        if (data.status) {
          setTokenStatus(data.status);
        }

        if (data.position !== null) {
          setPosition(data.position);
        }

        setPeopleAhead(data.peopleAhead ?? 0);
        setEstimatedWait(data.estimatedWait ?? 0);
      }
    } catch (error) {
      console.error("Failed to fetch token status:", error);
    }
  };

  fetchTokenStatus();

  const interval = setInterval(() => {
    fetchTokenStatus();
  }, 5000);

  return () => clearInterval(interval);
}, [token]);
  const serveNext = async () => {
  try {
    const response = await fetch(
      "http://localhost:5000/api/queue/serve-next",
      {
        method: "POST",
      }
    );

    const data = await response.json();

    if (!data.success) {
      alert(data.message);
      return;
    }

    await fetchQueue();

    alert(`${data.servedToken} is now being served.`);
  } catch (error) {
    console.error("Failed to serve next customer:", error);
    alert("Unable to connect to QueueMind AI backend.");
  }
};
const completeCurrent = async () => {
  try {
    const response = await fetch(
      "http://localhost:5000/api/queue/complete",
      {
        method: "POST",
      }
    );

    const data = await response.json();

    if (!data.success) {
      alert(data.message);
      return;
    }

    await fetchQueue();

    alert(`${data.completedToken} has been completed.`);
  } catch (error) {
    console.error("Failed to complete current customer:", error);
    alert("Unable to connect to QueueMind AI backend.");
  }
};

  // Take a token
  const takeToken = async () => {
    try {
      setLoading(true);

      const response = await fetch("http://localhost:5000/api/tokens", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          serviceId: selectedService,
        }),
      });

      const data = await response.json();

      setToken(data.token);
      setPosition(data.position);
      setPeopleAhead(data.peopleAhead);
      setEstimatedWait(data.estimatedWait);
      const predictionResponse = await fetch(
 `http://localhost:5000/api/predict/${data.token}`
);

const predictionData = await predictionResponse.json();

setPredictedWait(predictionData.predictedWait);

      setQueueLength(data.position);
      await fetchQueue();
    } catch (error) {
      console.error("Failed to get token:", error);
      alert("Unable to connect to QueueMind AI backend.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header className="navbar">
        <div className="logo">
          <span className="logo-icon">Q</span>
          <span>QueueMind AI</span>
        </div>

        <nav>
          <a href="#">Dashboard</a>
          <a href="#">My Queue</a>
          <a href="#">Analytics</a>
        </nav>

        <button
        className="admin-btn"
        onClick={() => setIsAdmin(!isAdmin)}
        >
          {isAdmin ? "Customer View" : "Admin"}
          </button>
        </header>

      <main>
        {isAdmin && (
  <section className="admin-dashboard">
    <div className="admin-header">
      <div>
        <p className="eyebrow">ADMIN DASHBOARD</p>
        <h2>Queue Control Center</h2>
      </div>

      <div className="admin-status">
        <span className="live">● LIVE</span>
      </div>
    </div>

    <div className="admin-stats">
  <div className="admin-stat-card">
    <small>People Waiting</small>
    <strong>{queueLength}</strong>
  </div>

  <div className="admin-stat-card">
    <small>Estimated Queue Time</small>
    <strong>{liveEstimatedWait} min</strong>
  </div>

  <div className="admin-stat-card">
    <small>Queue Status</small>
    <strong>{queueLength > 0 ? "Active" : "Empty"}</strong>
  </div>
</div>

{aiRecommendation && (
  <div className="ai-recommendation">
    <div>
      <p className="eyebrow">AI QUEUE OPTIMIZATION</p>
      <h3>Recommended Next Customer</h3>
    </div>

    <div className="ai-recommendation-main">
      <strong>{aiRecommendation.token}</strong>

      <span>{aiRecommendation.service}</span>

      <span>
        Predicted wait: {aiRecommendation.predictedWait} min
      </span>

      <span>
        Waiting: {aiRecommendation.waitingMinutes} min
      </span>
    </div>

    <p className="ai-recommendation-reason">
      {aiRecommendation.reason}
    </p>
  </div>
)}

    <div className="serve-card">
      <div>
        <small>NEXT CUSTOMER</small>
        <h3>{queueLength > 0 ? "Ready to serve" : "No customers waiting"}</h3>
      </div>

      <button
      className="primary-btn"
      onClick={serveNext}
      disabled={queueLength === 0}
      >
        ✓ Serve Next
      </button>
      <button
  className="primary-btn"
  onClick={completeCurrent}
  disabled={!liveNowServing}
>
  Complete Current
</button>
    </div>
  {analytics && (
  <div className="analytics-section">
    <div className="section-heading">
      <p className="eyebrow">QUEUE ANALYTICS</p>
      <h2>Performance Overview</h2>
    </div>

    {/* Overall analytics */}
    <div className="analytics-grid">
      <div className="analytics-card">
        <small>Total Customers</small>
        <strong>{analytics.totalCustomers}</strong>
      </div>

      <div className="analytics-card">
        <small>Customers Served</small>
        <strong>{analytics.customersServed}</strong>
      </div>

      <div className="analytics-card">
        <small>Currently Waiting</small>
        <strong>{analytics.customersWaiting}</strong>
      </div>

      <div className="analytics-card">
        <small>Average Wait Time</small>
        <strong>{analytics.averageWaitTime} min</strong>
      </div>
    </div>

    {/* Service-wise analytics */}
    {serviceAnalytics.length > 0 && (
      <div className="service-analytics">
        <div className="section-heading">
          <p className="eyebrow">SERVICE PERFORMANCE</p>
          <h2>Service-wise Analytics</h2>
        </div>

        <div className="service-analytics-grid">
          {serviceAnalytics.map((service) => (
            <div
              className="service-analytics-card"
              key={service.service}
            >
              <h3>{service.service}</h3>

              <div className="service-metric">
                <span>Total Customers</span>
                <strong>{service.totalCustomers}</strong>
              </div>

              <div className="service-metric">
                <span>Customers Served</span>
                <strong>{service.customersServed}</strong>
              </div>

              <div className="service-metric">
                <span>Currently Waiting</span>
                <strong>{service.customersWaiting}</strong>
              </div>

              <div className="service-metric">
                <span>Average Wait</span>
                <strong>
                  {service.averageWaitTime} min
                </strong>
              </div>
            </div>
          ))}
        </div>
      </div>
    )}
  </div>
)}
  </section>
)}
        <section className="hero">
          <div>
            <p className="eyebrow">AI-POWERED QUEUE MANAGEMENT</p>

            <h1>
              Smart queues.
              <br />
              <span>Less waiting.</span>
            </h1>

            <p className="hero-text">
              Take a digital token, track your position, and get intelligent
              waiting-time predictions in real time.
            </p>
            <select
            value={selectedService}
            onChange={(e) => setSelectedService(e.target.value)}
          ><option value="general">🏥 General Consultation</option>
<option value="billing">💳 Billing & Payments</option>
<option value="documents">📄 Document Services</option>
            </select>

            <button
              className="primary-btn"
              onClick={takeToken}
              disabled={loading}
            >
              {loading ? "Generating..." : "🎟 Take a Token"}
            </button>
          </div>

          <div className="queue-card">
            <div className="card-header">
              <span>Live Queue</span>
              <span className="live">● LIVE</span>
            </div>

            <div className="current-token">
              <small>NOW SERVING</small>
              <strong>
                {liveNowServing || "---"}
              </strong>
            </div>

            <div className="queue-stats">
              <div>
                <small>People Waiting</small>
                <strong>{queueLength}</strong>
              </div>

              <div>
                <small>Estimated Wait</small>
                <strong>{liveEstimatedWait} min</strong>
              </div>
            </div>
          </div>
        </section>

        {token && (
          <section className="token-result">
            <p>Your token has been generated</p>

            <h2>{token}</h2>

           <div className="token-info">
            <span>Service: {serviceNames[selectedService]}</span>
            <span>Status: {tokenStatus}</span>
            <span>Position: {position}</span>
            <span>People ahead: {peopleAhead}</span>
            <span>Estimated wait: {estimatedWait} min</span>
            <span>AI predicted wait: {predictedWait} min</span>
          </div>
          </section>
        )}

        <section className="services">
          <div className="section-heading">
            <p className="eyebrow">SERVICES</p>
            <h2>Choose a service</h2>
          </div>

          <div className="service-grid">
            <div className="service-card">
              <div className="service-icon">🏥</div>
              <h3>General Consultation</h3>
              <p>Average service time: 5 min</p>
              <span>12 people waiting</span>
            </div>

            <div className="service-card">
              <div className="service-icon">💳</div>
              <h3>Billing & Payments</h3>
              <p>Average service time: 4 min</p>
              <span>8 people waiting</span>
            </div>

            <div className="service-card">
              <div className="service-icon">📄</div>
              <h3>Document Services</h3>
              <p>Average service time: 7 min</p>
              <span>5 people waiting</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;