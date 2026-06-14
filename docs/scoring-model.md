## Explainable Scoring Heuristics & Weights 
The reasoning agent does not rely on opaque deep learning model scores alone. Instead, it utilizes transparent, multi-dimensional heuristic models for amplification risk and coordination simulation. This allows every decision to be fully explainable and auditable. 

### 1. Amplification Risk Weights The amplification risk score is computed as a weighted sum of six key indicators:

*   **Engagement Velocity (28%):** *Rationale:* The rate of interaction (likes, shares, reports per minute) is the most critical operational predictor of propagation. High velocity requires rapid preventative mitigation.
*   **Topic Sensitivity (20%):** *Rationale:* Critical civic areas (e.g., elections, public safety) have a disproportionately high risk of societal harm and viral misinformation.
*   **Emotional Intensity (16%):** *Rationale:* Language with high emotional valence (e.g., urgency terms, calls to action) is psychologically proven to increase user sharing rates.
*   **Novelty & Source Uncertainty (16%):** *Rationale:* Unverified claims or leaks lacking reliable citation sources have higher rumor-spread risk. Verified badges act as a negative modifier (safety boost).
*   **Polarization Pressure (12%):** *Rationale:* Divisive us-vs-them language and report density indicate elevated conflict risk.
*   **Network Reach (8%):** *Rationale:* Author follower count dictates baseline potential exposure, providing the initial audience reach scale.

### 2. Coordination Simulation Weights The coordination score identifies potential inauthentic bot networks using six indicators:

*   **Synchronized Engagement (22%):** *Rationale:* Coordinated bursts or programmatic metadata flags indicate automated/orchestrated network behavior.
*   **Coordinated Timing & Phrasing (20%):** *Rationale:* Repeated phrases, identical timestamps, or lexicon markers (e.g., "mass report", "bot army").
*   **Repost Density (18%):** *Rationale:* A highly skewed share-to-like ratio is a classic indicator of automated amplification script activity.
*   **Follower Anomalies (16%):** *Rationale:* Brand-new or low-age accounts executing high-volume actions.
*   **Engagement Spikes (16%):** *Rationale:* Sudden, non-linear surges in engagement metrics.
*   **Report Pressure (8%):** *Rationale:* Community flagging signals indicating user-detected coordination.
