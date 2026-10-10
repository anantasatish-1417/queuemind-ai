import sys
import os
import joblib

# Load trained model
model_path = os.path.join(
    os.path.dirname(__file__),
    "queue_wait_model.pkl"
)

model = joblib.load(model_path)

# Read input values
average_service_time = float(sys.argv[1])
people_ahead = int(sys.argv[2])
baseline_wait = float(sys.argv[3])

# Prepare features
features = [[
    average_service_time,
    people_ahead,
    baseline_wait
]]

# Predict waiting time
prediction = model.predict(features)[0]

# Return prediction
print(round(max(0, prediction), 2))