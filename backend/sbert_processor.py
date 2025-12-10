import os
import warnings
import sys
from typing import Dict, List, Tuple, Optional, Callable
import numpy as np
from sentence_transformers import SentenceTransformer
import torch

# Suppress warnings globally
warnings.filterwarnings("ignore")

# Force stdout/stderr to be unbuffered for real-time logging
try:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(line_buffering=True)
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(line_buffering=True)
except:
    pass  # Fallback if reconfigure fails

class SBERTProcessor:
    """Process MCQs using SBERT for similarity detection"""
    
    def __init__(self, threshold: float = 0.85):
        self.threshold = threshold
        self.model = None
        self.device = None
        self._load_model()
    
    def _load_model(self):
        """Load SBERT model with error handling for meta tensor issues"""
        model_name = 'paraphrase-multilingual-MiniLM-L12-v2'
        
        try:
            # Try normal loading first
            self.model = SentenceTransformer(model_name)
            self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
            self.model.to(self.device)
        except Exception as e:
            # Fallback: Force CPU and handle meta tensor issues
            try:
                print(f"Warning: Initial model load failed, trying CPU fallback: {e}")
                self.device = torch.device('cpu')
                # Force CPU loading
                os.environ['CUDA_VISIBLE_DEVICES'] = ''
                self.model = SentenceTransformer(model_name, device='cpu')
            except Exception as e2:
                print(f"Error loading model: {e2}")
                raise
    
    def process_subject(self, 
                       statements: Dict[str, str], 
                       cached_embeddings: Optional[Dict[str, np.ndarray]] = None,
                       progress_callback: Optional[Callable] = None) -> Tuple[Dict[str, np.ndarray], List[Dict], int, List[Dict[str, int]]]:
        """
        Process statements and find similar pairs
        
        Args:
            statements: Dictionary of {filename: statement}
            cached_embeddings: Optional cached embeddings
            progress_callback: Optional callback for progress updates
            
        Returns:
            Tuple of (embeddings, groups_pairwise, non_duplicate_count)
        """
        if not statements:
            return {}, [], 0
        
        filenames = list(statements.keys())
        texts = [statements[f] for f in filenames]
        
        # Generate embeddings
        embeddings_dict = {}
        if cached_embeddings:
            # Use cached embeddings where available
            for i, filename in enumerate(filenames):
                if filename in cached_embeddings:
                    embeddings_dict[filename] = cached_embeddings[filename]
                else:
                    # Generate new embedding
                    embedding = self.model.encode([texts[i]], convert_to_numpy=True)[0]
                    embeddings_dict[filename] = embedding
        else:
            # Generate all embeddings
            print(f"[SBERT] Generating embeddings for {len(texts):,} files...", flush=True)
            if progress_callback:
                progress_callback(0, "Generating embeddings...")
            
            # Generate embeddings in batches to avoid memory issues
            batch_size = 32
            total_batches = (len(texts) + batch_size - 1) // batch_size
            last_reported_percent = -1
            
            for batch_idx, i in enumerate(range(0, len(texts), batch_size)):
                batch_texts = texts[i:i+batch_size]
                batch_filenames = filenames[i:i+batch_size]
                
                batch_embeddings = self.model.encode(batch_texts, convert_to_numpy=True, show_progress_bar=False)
                
                for j, filename in enumerate(batch_filenames):
                    embeddings_dict[filename] = batch_embeddings[j]
                
                # Report every 5% or every 10 batches
                progress = int((i + len(batch_texts)) / len(texts) * 50)  # First 50% for embeddings
                if progress > last_reported_percent or batch_idx % 10 == 0:
                    last_reported_percent = progress
                    print(f"[SBERT] Progress: {progress}% - Generated embeddings for {i + len(batch_texts):,}/{len(texts):,} files", flush=True)
                    if progress_callback:
                        progress_callback(progress, f"Generating embeddings... {i + len(batch_texts)}/{len(texts)}")
        
        # Find similar pairs
        print(f"[SBERT] Computing similarity matrix...", flush=True)
        if progress_callback:
            progress_callback(50, "Finding similar pairs...")
        
        similar_pairs = []
        embeddings_list = [embeddings_dict[f] for f in filenames]
        embeddings_array = np.array(embeddings_list)
        
        # Calculate cosine similarity for all pairs
        # Normalize embeddings
        print(f"[SBERT] Normalizing embeddings...", flush=True)
        norms = np.linalg.norm(embeddings_array, axis=1, keepdims=True)
        norms[norms == 0] = 1  # Avoid division by zero
        normalized_embeddings = embeddings_array / norms
        
        # Compute similarity matrix (cosine similarity)
        print(f"[SBERT] Computing dot product matrix...", flush=True)
        similarity_matrix = np.dot(normalized_embeddings, normalized_embeddings.T)
        print(f"[SBERT] Similarity matrix computed: {similarity_matrix.shape}", flush=True)
        
        # Find pairs above threshold
        total_pairs = len(filenames) * (len(filenames) - 1) // 2
        processed = 0
        last_reported_percent = 0
        
        print(f"[SBERT] Starting similarity check: {total_pairs:,} pairs to process", flush=True)
        
        for i in range(len(filenames)):
            for j in range(i + 1, len(filenames)):
                similarity = float(similarity_matrix[i][j])
                if similarity >= self.threshold:
                    similar_pairs.append({
                        'files': [filenames[i], filenames[j]],
                        'similarity': similarity,
                        'max_similarity': similarity  # For frontend compatibility
                    })
                
                processed += 1
                # Report progress every 1% or every 10000 pairs (whichever is more frequent)
                current_percent = int((processed / total_pairs) * 50)  # Last 50% for similarity
                if current_percent > last_reported_percent or processed % 10000 == 0:
                    progress = 50 + current_percent
                    last_reported_percent = current_percent
                    print(f"[SBERT] Progress: {progress}% - Processed {processed:,}/{total_pairs:,} pairs", flush=True)
                    if progress_callback:
                        progress_callback(progress, f"Finding similar pairs... {processed}/{total_pairs}")
        
        # Create pairwise groups (each pair is a group)
        groups_pairwise = similar_pairs
        print(f"[SBERT] Found {len(similar_pairs):,} similar pairs", flush=True)
        
        # Count non-duplicates (files not in any group)
        print(f"[SBERT] Counting non-duplicates...", flush=True)
        files_in_groups = set()
        for group in groups_pairwise:
            files_in_groups.update(group['files'])
        non_duplicate_count = len(filenames) - len(files_in_groups)

        # Build similarity bin counts (percentage ranges: 100-99, 99-98, ..., 87-86)
        bin_ranges = [(i, i - 1) for i in range(100, 85, -1)]
        bin_counts = {f"{upper}-{lower}": 0 for upper, lower in bin_ranges}

        for pair in groups_pairwise:
            sim_percent = min(100, max(0, pair.get('similarity', 0) * 100))
            for upper, lower in bin_ranges:
                if sim_percent <= upper and sim_percent > lower:
                    bin_counts[f"{upper}-{lower}"] += 1
                    break

        # Convert to list for JSON friendliness
        bin_counts_list = [{"range": k, "count": v} for k, v in bin_counts.items()]
        
        print(f"[SBERT] ✓ Processing complete! Non-duplicates: {non_duplicate_count:,}", flush=True)
        if progress_callback:
            progress_callback(100, "Processing complete!")
        
        return embeddings_dict, groups_pairwise, non_duplicate_count, bin_counts_list
    
    def stop(self):
        """Clean up resources"""
        if self.model is not None:
            # Clear model from memory
            del self.model
            self.model = None
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
