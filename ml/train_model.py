import pandas as pd

# Load training data
df = pd.read_csv("ml/queue_training_data.csv")

print("Dataset loaded successfully!")
print()

print("Shape:")
print(df.shape)

print()

print("Columns:")
print(df.columns.tolist())

print()

print("Dataset:")
print(df)

print()

print("Missing values:")
print(df.isnull().sum())
# Features and target
X = df[
    [
        "average_service_time",
        "people_ahead",
        "baseline_wait",
    ]
]

y = df["actual_wait"]

print()
print("Features (X):")
print(X)

print()
print("Target (y):")
print(y)
from sklearn.linear_model import LinearRegression

# Create and train the model
model = LinearRegression()

model.fit(X, y)

print()
print("Model trained successfully!")

print()
print("Model coefficients:")
print(model.coef_)

print()
print("Model intercept:")
print(model.intercept_)
# Make predictions on the dataset
predictions = model.predict(X)

print()
print("Predictions:")
for actual, predicted in zip(y, predictions):
    print(f"Actual: {actual:.2f} min | Predicted: {predicted:.2f} min")

from sklearn.metrics import mean_absolute_error

# Calculate prediction error
mae = mean_absolute_error(y, predictions)

print()
print(f"Mean Absolute Error: {mae:.2f} minutes")
# Compare ML model with baseline prediction
baseline_mae = mean_absolute_error(y, df["baseline_wait"])

print()
print(f"Baseline MAE: {baseline_mae:.2f} minutes")
print(f"ML Model MAE: {mae:.2f} minutes")

if mae < baseline_mae:
    print("ML model performs better than the baseline.")
else:
    print("Baseline performs better than the ML model.")

from sklearn.model_selection import cross_val_score

# 5-fold cross-validation
cv_scores = cross_val_score(
    model,
    X,
    y,
    cv=5,
    scoring="neg_mean_absolute_error"
)

cv_mae = -cv_scores.mean()

print()
print("5-Fold Cross-Validation:")
print("Fold MAE values:", -cv_scores)
print(f"Cross-validated MAE: {cv_mae:.2f} minutes")
import joblib

# Save the trained model
joblib.dump(model, "ml/queue_wait_model.pkl")

print()
print("Model saved successfully!")
print("File: ml/queue_wait_model.pkl")