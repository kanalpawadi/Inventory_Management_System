# """
# ml/explainability.py

# Step 4b: SHAP explainability for the XGBoost model -- answers "why did the
# model predict X units for this product on this day?" by decomposing each
# prediction into per-feature contributions (e.g. "pushed up by promo_flag,
# pulled down by a low rolling_mean_7").

# This feeds the /explain API endpoint later: the frontend can show a waterfall
# chart of feature contributions for any product/date in the test window.

# Inputs:  backend/ml/models/xgboost_model.json        (from xgboost_model.py)
#          backend/data/processed/features.parquet
# Outputs: backend/data/processed/shap_explanations.parquet  (long format: one row
#              per product/date/feature, with that feature's SHAP contribution)
#          backend/ml/models/shap_global_importance.json      (mean |SHAP| per
#              feature across the test set -- overall "what matters most" ranking)

# Run:
#     cd backend
#     python -m ml.explainability
# """

# import json
# import os
# import sys

# import numpy as np
# import pandas as pd
# import shap
# import xgboost as xgb

# sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# from ml.xgboost_model import FEATURE_COLUMNS, TEST_DAYS, time_based_split

# BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# FEATURES_PATH = os.path.join(BACKEND_DIR, "data", "processed", "features.parquet")
# MODEL_PATH = os.path.join(BACKEND_DIR, "ml", "models", "xgboost_model.json")
# MODELS_DIR = os.path.join(BACKEND_DIR, "ml", "models")
# EXPLANATIONS_PATH = os.path.join(BACKEND_DIR, "data", "processed", "shap_explanations.parquet")


# def load_model() -> xgb.XGBRegressor:
#     if not os.path.exists(MODEL_PATH):
#         raise FileNotFoundError(f"Missing {MODEL_PATH}. Run `python -m ml.xgboost_model` first.")
#     model = xgb.XGBRegressor()
#     model.load_model(MODEL_PATH)
#     return model


# def compute_shap_values(model: xgb.XGBRegressor, test_df: pd.DataFrame):
#     explainer = shap.TreeExplainer(model)
#     shap_output = explainer(test_df[FEATURE_COLUMNS])
#     return shap_output  # has .values (n_rows, n_features), .base_values (n_rows,), .data


# def build_long_format(test_df: pd.DataFrame, shap_output) -> pd.DataFrame:
#     """One row per (product_id, date, feature) -- flexible for the API to
#     slice by product/date and reconstruct a waterfall chart."""
#     rows = []
#     test_df = test_df.reset_index(drop=True)

#     for i in range(len(test_df)):
#         base_value = float(shap_output.base_values[i])
#         predicted_value = base_value + float(shap_output.values[i].sum())

#         for j, feature in enumerate(FEATURE_COLUMNS):
#             rows.append({
#                 "product_id": test_df.loc[i, "product_id"],
#                 "product_name": test_df.loc[i, "product_name"],
#                 "date": test_df.loc[i, "date"],
#                 "feature": feature,
#                 "feature_value": float(test_df.loc[i, feature]),
#                 "shap_value": float(shap_output.values[i, j]),
#                 "base_value": base_value,
#                 "predicted_value": predicted_value,
#             })

#     return pd.DataFrame(rows)


# def compute_global_importance(shap_output) -> dict:
#     mean_abs_shap = np.abs(shap_output.values).mean(axis=0)
#     importance = dict(zip(FEATURE_COLUMNS, mean_abs_shap.tolist()))
#     return dict(sorted(importance.items(), key=lambda kv: kv[1], reverse=True))


# def main():
#     if not os.path.exists(FEATURES_PATH):
#         raise FileNotFoundError(
#             f"Missing {FEATURES_PATH}. Run `python -m data_prep.feature_engineering` first."
#         )

#     print("Loading XGBoost model and features ...")
#     model = load_model()
#     df = pd.read_parquet(FEATURES_PATH)
#     df = df.dropna(subset=FEATURE_COLUMNS + ["quantity_sold"])

#     _, test_df = time_based_split(df, TEST_DAYS)
#     print(f"Computing SHAP values for {len(test_df)} test rows ...")

#     shap_output = compute_shap_values(model, test_df)

#     long_df = build_long_format(test_df, shap_output)
#     long_df.to_parquet(EXPLANATIONS_PATH, index=False)
#     print(f"Saved per-row SHAP explanations to {EXPLANATIONS_PATH} ({len(long_df)} rows)")

#     global_importance = compute_global_importance(shap_output)
#     print("\n=== Global feature importance (mean |SHAP| across test set) ===")
#     for feature, value in global_importance.items():
#         print(f"  {feature:28s}: {value:.4f}")

#     with open(os.path.join(MODELS_DIR, "shap_global_importance.json"), "w") as f:
#         json.dump(global_importance, f, indent=2)
#     print(f"\nSaved global feature importance to {os.path.join(MODELS_DIR, 'shap_global_importance.json')}")


# if __name__ == "__main__":
#     main()


"""
ml/explainability.py

Step 4b: SHAP explainability for the XGBoost model -- answers "why did the
model predict X units for this product on this day?" by decomposing each
prediction into per-feature contributions (e.g. "pushed up by promo_flag,
pulled down by a low rolling_mean_7").

This feeds the /explain API endpoint later: the frontend can show a waterfall
chart of feature contributions for any product/date in the test window.

Inputs:  backend/ml/models/xgboost_model.json        (from xgboost_model.py)
         backend/data/processed/features.parquet
Outputs: backend/data/processed/shap_explanations.parquet  (long format: one row
             per product/date/feature, with that feature's SHAP contribution)
         backend/ml/models/shap_global_importance.json      (mean |SHAP| per
             feature across the test set -- overall "what matters most" ranking)

Run:
    cd backend
    python -m ml.explainability
"""
"""
ml/explainability.py

Step 4b: SHAP explainability for the XGBoost model -- answers "why did the
model predict X units for this product on this day?" by decomposing each
prediction into per-feature contributions.

NOTE on implementation: this uses shap.Explainer(model.predict, background)
-- a black-box "permutation" explainer -- rather than shap.TreeExplainer.
TreeExplainer inspects XGBoost's internal booster structure directly, which
breaks on newer XGBoost versions (2.x+) that store `base_score` as a
stringified array for multi-output support; several shap versions crash on
this with `ValueError: could not convert string to float: '[...]'`. The
black-box approach only ever calls model.predict(), so it can't be affected
by that internal representation at all -- at the cost of being somewhat
slower (a few seconds per row rather than near-instant), which is fine at
our test-set scale (~140 rows).

Inputs:  backend/ml/models/xgboost_model.json        (from xgboost_model.py)
         backend/data/processed/features.parquet
Outputs: backend/data/processed/shap_explanations.parquet  (long format: one row
             per product/date/feature, with that feature's SHAP contribution)
         backend/ml/models/shap_global_importance.json      (mean |SHAP| per
             feature across the test set -- overall "what matters most" ranking)

Run:
    cd backend
    python -m ml.explainability
"""

import json
import os
import sys

import numpy as np
import pandas as pd
# pyrefly: ignore [missing-import]
import shap
import xgboost as xgb

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ml.xgboost_model import FEATURE_COLUMNS, TEST_DAYS, time_based_split

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FEATURES_PATH = os.path.join(BACKEND_DIR, "data", "processed", "features.parquet")
MODEL_PATH = os.path.join(BACKEND_DIR, "ml", "models", "xgboost_model.json")
MODELS_DIR = os.path.join(BACKEND_DIR, "ml", "models")
EXPLANATIONS_PATH = os.path.join(BACKEND_DIR, "data", "processed", "shap_explanations.parquet")

BACKGROUND_SAMPLE_SIZE = 50  # reference dataset the permutation explainer perturbs against


def load_model() -> xgb.XGBRegressor:
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(f"Missing {MODEL_PATH}. Run `python -m ml.xgboost_model` first.")
    model = xgb.XGBRegressor()
    model.load_model(MODEL_PATH)
    return model


def compute_shap_values(model: xgb.XGBRegressor, train_like_df: pd.DataFrame, test_df: pd.DataFrame):
    """Black-box permutation explainer: only ever calls model.predict(), so
    it's immune to the XGBoost-internals parsing bug that affects TreeExplainer
    on some shap/xgboost version combinations."""
    background = train_like_df[FEATURE_COLUMNS].sample(
        min(BACKGROUND_SAMPLE_SIZE, len(train_like_df)), random_state=42
    )
    explainer = shap.Explainer(model.predict, background)
    print(f"Running permutation explainer on {len(test_df)} rows "
          f"(this is the slow, robust path -- expect ~1-2 min for ~140 rows) ...")
    shap_output = explainer(test_df[FEATURE_COLUMNS])
    return shap_output


def build_long_format(test_df: pd.DataFrame, shap_output) -> pd.DataFrame:
    rows = []
    test_df = test_df.reset_index(drop=True)

    for i in range(len(test_df)):
        base_value = float(shap_output.base_values[i])
        predicted_value = base_value + float(shap_output.values[i].sum())

        for j, feature in enumerate(FEATURE_COLUMNS):
            rows.append({
                "product_id": test_df.loc[i, "product_id"],
                "product_name": test_df.loc[i, "product_name"],
                "date": test_df.loc[i, "date"],
                "feature": feature,
                "feature_value": float(test_df.loc[i, feature]),
                "shap_value": float(shap_output.values[i, j]),
                "base_value": base_value,
                "predicted_value": predicted_value,
            })

    return pd.DataFrame(rows)


def compute_global_importance(shap_output) -> dict:
    mean_abs_shap = np.abs(shap_output.values).mean(axis=0)
    importance = dict(zip(FEATURE_COLUMNS, mean_abs_shap.tolist()))
    return dict(sorted(importance.items(), key=lambda kv: kv[1], reverse=True))


def main():
    if not os.path.exists(FEATURES_PATH):
        raise FileNotFoundError(
            f"Missing {FEATURES_PATH}. Run `python -m data_prep.feature_engineering` first."
        )

    print("Loading XGBoost model and features ...")
    model = load_model()
    df = pd.read_parquet(FEATURES_PATH)
    df = df.dropna(subset=FEATURE_COLUMNS + ["quantity_sold"])

    train_df, test_df = time_based_split(df, TEST_DAYS)

    shap_output = compute_shap_values(model, train_df, test_df)

    long_df = build_long_format(test_df, shap_output)
    long_df.to_parquet(EXPLANATIONS_PATH, index=False)
    print(f"Saved per-row SHAP explanations to {EXPLANATIONS_PATH} ({len(long_df)} rows)")

    global_importance = compute_global_importance(shap_output)
    print("\n=== Global feature importance (mean |SHAP| across test set) ===")
    for feature, value in global_importance.items():
        print(f"  {feature:28s}: {value:.4f}")

    with open(os.path.join(MODELS_DIR, "shap_global_importance.json"), "w") as f:
        json.dump(global_importance, f, indent=2)
    print(f"\nSaved global feature importance to {os.path.join(MODELS_DIR, 'shap_global_importance.json')}")


if __name__ == "__main__":
    main()