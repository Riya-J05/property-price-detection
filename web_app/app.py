"""
Property Price Prediction Web Application - Flask Backend
==========================================================
Loads the fitted scikit-learn pipeline from models/property_price_pipeline.joblib
and serves the prediction endpoint for Delhi-NCR property valuations.
"""

from pathlib import Path
import logging
import joblib
import pandas as pd
from flask import Flask, render_template, request, jsonify

# Set up logging (logs stay on the server; never leaked to client JSON responses)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("property_price_app")

# 1. ROBUST PATH RESOLUTION WITH PATHLIB
# BASE_DIR is the web_app/ directory
BASE_DIR = Path(__file__).resolve().parent
# ROOT_DIR is the project root (contains models/, data/, notebooks/)
ROOT_DIR = BASE_DIR.parent
MODEL_PATH = ROOT_DIR / "models" / "property_price_pipeline.joblib"

# 2. INITIALIZE FLASK APPLICATION
app = Flask(
    __name__,
    template_folder="templates",
    static_folder="static"
)

# 3. LOAD THE FITTED MODEL ONCE AT SERVER STARTUP
pipeline = None
try:
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Model file not found at expected path: {MODEL_PATH}")
    
    logger.info("Loading fitted scikit-learn pipeline from %s ...", MODEL_PATH)
    pipeline = joblib.load(MODEL_PATH)
    logger.info("Pipeline loaded successfully into memory. Steps: %s", [step[0] for step in pipeline.steps])
except Exception as e:
    logger.critical("Failed to load model pipeline: %s", e, exc_info=True)
    # We do not crash silently; pipeline remains None and requests will return a safe 503 error.

# 4. EXPECTED FEATURES AND ALLOWED CATEGORIES
# Must match pipeline.feature_names_in_ exactly
REQUIRED_FEATURES = [
    "property_type", "location", "area_sqft", "bedrooms", "bathrooms",
    "age_years", "floor", "total_floors", "parking", "furnishing",
    "distance_to_metro_km", "nearby_schools", "monthly_maintenance_inr",
    "has_gym", "has_security"
]

ALLOWED_CATEGORICALS = {
    "property_type": {"apartment", "builder floor", "independent house"},
    "location": {
        "dwarka", "gurugram", "janakpuri", "noida",
        "paschim vihar", "pitampura", "rohini", "uttam nagar"
    },
    "parking": {"no", "yes"},
    "furnishing": {"fully-furnished", "semi-furnished", "unfurnished"},
    "has_gym": {"no", "yes"},
    "has_security": {"no", "yes"}
}

NUMERIC_BOUNDS = {
    "area_sqft": (100.0, 50000.0, "Built-up area (sq ft)"),
    "bedrooms": (1, 20, "Bedrooms"),
    "bathrooms": (1, 15, "Bathrooms"),
    "age_years": (0.0, 150.0, "Property age (years)"),
    "floor": (0, 100, "Floor number"),
    "total_floors": (1, 100, "Total floors"),
    "distance_to_metro_km": (0.0, 50.0, "Distance to metro (km)"),
    "nearby_schools": (0, 30, "Nearby schools"),
    "monthly_maintenance_inr": (0.0, 500000.0, "Monthly maintenance (INR)")
}


def validate_and_clean_input(payload):
    """
    Validates and normalizes incoming client JSON against model specifications.
    Returns (cleaned_dict, None) on success or (None, error_message) on failure.
    """
    if not isinstance(payload, dict):
        return None, "Invalid request payload. Expected a JSON object."

    cleaned = {}

    # Check for missing features
    missing_fields = [feat for feat in REQUIRED_FEATURES if feat not in payload]
    if missing_fields:
        return None, f"Missing required fields: {', '.join(missing_fields)}"

    # Validate categorical features
    for col, allowed_vals in ALLOWED_CATEGORICALS.items():
        raw_val = payload.get(col)
        if not isinstance(raw_val, str):
            return None, f"Field '{col}' must be a string."
        norm_val = raw_val.strip().lower()
        if norm_val not in allowed_vals:
            return None, (
                f"Invalid value '{raw_val}' for '{col}'. "
                f"Allowed values are: {', '.join(sorted(allowed_vals))}."
            )
        cleaned[col] = norm_val

    # Validate numeric features
    for col, (min_val, max_val, label) in NUMERIC_BOUNDS.items():
        raw_val = payload.get(col)
        try:
            val = float(raw_val)
        except (ValueError, TypeError):
            return None, f"Field '{col}' must be a valid number."

        if val < min_val or val > max_val:
            return None, f"{label} must be between {min_val} and {max_val}."

        # Preserve integer types for count fields
        if col in {"bedrooms", "bathrooms", "floor", "total_floors", "nearby_schools"}:
            cleaned[col] = int(round(val))
        else:
            cleaned[col] = val

    # Logical constraint: property floor cannot exceed total building floors
    if cleaned["floor"] > cleaned["total_floors"]:
        return None, (
            f"Property floor ({cleaned['floor']}) cannot be greater than "
            f"the total floors in the building ({cleaned['total_floors']})."
        )

    return cleaned, None


# 5. ROUTES

@app.route("/", methods=["GET"])
def home():
    """Renders the main property price estimator page."""
    return render_template("index.html")


@app.route("/health", methods=["GET"])
def health():
    """Health-check endpoint for diagnostics."""
    return jsonify({
        "status": "healthy" if pipeline is not None else "degraded",
        "model_loaded": pipeline is not None,
        "model_path": str(MODEL_PATH.name)
    }), 200 if pipeline is not None else 503


@app.route("/predict", methods=["POST"])
def predict():
    """
    Inference endpoint: accepts JSON, runs validation, builds a pandas DataFrame,
    calls pipeline.predict(), and returns the estimated price.
    """
    if pipeline is None:
        logger.error("Predict endpoint called but pipeline is not loaded.")
        return jsonify({
            "success": False,
            "error": "The machine learning model is currently unavailable on the server."
        }), 503

    if not request.is_json:
        return jsonify({
            "success": False,
            "error": "Request body must be JSON with 'Content-Type: application/json'."
        }), 400

    raw_data = request.get_json(silent=True)
    if not raw_data:
        return jsonify({
            "success": False,
            "error": "Empty or malformed JSON payload received."
        }), 400

    # 1. Validation
    cleaned_input, error_msg = validate_and_clean_input(raw_data)
    if error_msg:
        return jsonify({
            "success": False,
            "error": error_msg
        }), 400

    # 2. DataFrame Construction
    try:
        # Construct 1-row DataFrame with the exact column order expected by the pipeline
        input_df = pd.DataFrame([cleaned_input], columns=REQUIRED_FEATURES)

        # 3. Model Prediction
        # The pipeline's ColumnTransformer automatically applies imputers, StandardScaler,
        # PowerTransformer (Yeo-Johnson), and OneHotEncoder before running LinearRegression.
        predicted_array = pipeline.predict(input_df)
        pred_lakhs = float(predicted_array[0])

        # Prevent unrealistic negative predictions if an extreme outlier is supplied
        final_lakhs = max(1.0, round(pred_lakhs, 2))

        # Format Indian Rupee representation
        if final_lakhs >= 100:
            formatted_price = f"₹{final_lakhs / 100:.2f} Crore"
        else:
            formatted_price = f"₹{final_lakhs:.2f} Lakhs"

        logger.info(
            "Prediction computed successfully: %.2f Lakhs (%s) for %s in %s",
            final_lakhs, formatted_price, cleaned_input["property_type"], cleaned_input["location"]
        )

        return jsonify({
            "success": True,
            "price_lakhs": final_lakhs,
            "formatted_price": formatted_price
        }), 200

    except Exception as e:
        # Log the full stack trace on the server for debugging
        logger.error("Unexpected error during model inference: %s", e, exc_info=True)
        # Return a safe, user-friendly message without leaking internal paths or traceback
        return jsonify({
            "success": False,
            "error": "An unexpected server error occurred while processing the prediction."
        }), 500


if __name__ == "__main__":
    # When running directly: python app.py
    logger.info("Starting Flask development server on http://127.0.0.1:5000 ...")
    app.run(host="127.0.0.1", port=5000, debug=True)
