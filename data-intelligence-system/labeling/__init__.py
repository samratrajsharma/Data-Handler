"""
Labeling sub-package — rule-based, AI-powered, and similarity-based labeling engine.
"""

from labeling.rule_engine import LabelingRule, LabelingReport, SUPPORTED_OPERATORS
from labeling.ai_labeler import predict_text_labels, predict_image_labels, AILabelingReport
from labeling.similarity_propagator import propagate_labels, PropagationReport
from labeling.label_aggregator import aggregate_labels, AggregationReport
