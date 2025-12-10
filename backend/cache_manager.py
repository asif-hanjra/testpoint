import os
import json
import pickle
import hashlib
from pathlib import Path
from typing import Dict, List, Optional
import numpy as np

class CacheManager:
    """Manages embedding cache for faster subsequent runs"""
    
    def __init__(self, cache_dir: str = ".cache"):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(exist_ok=True)
        
    def _get_cache_key(self, subject: str) -> str:
        """Generate cache key based on subject and files"""
        return f"{subject}_embeddings"
    
    def _get_cache_path(self, subject: str) -> Path:
        """Get cache file path for subject"""
        cache_key = self._get_cache_key(subject)
        return self.cache_dir / f"{cache_key}.pkl"
    
    def load_embeddings(self, subject: str) -> Optional[Dict]:
        """Load cached embeddings for subject"""
        cache_path = self._get_cache_path(subject)
        
        if not cache_path.exists():
            return None
        
        try:
            with open(cache_path, 'rb') as f:
                data = pickle.load(f)
            print(f"✓ Loaded embeddings from cache for {subject}")
            return data
        except Exception as e:
            print(f"Warning: Failed to load cache: {e}")
            return None
    
    def save_embeddings(self, subject: str, data: Dict):
        """Save embeddings to cache"""
        cache_path = self._get_cache_path(subject)
        
        try:
            with open(cache_path, 'wb') as f:
                pickle.dump(data, f)
            print(f"✓ Saved embeddings to cache for {subject}")
        except Exception as e:
            print(f"Warning: Failed to save cache: {e}")
    
    def clear_cache(self, subject: Optional[str] = None):
        """Clear cache for specific subject or all"""
        if subject:
            cache_path = self._get_cache_path(subject)
            if cache_path.exists():
                cache_path.unlink()
                print(f"✓ Cleared cache for {subject}")
        else:
            for cache_file in self.cache_dir.glob("*.pkl"):
                cache_file.unlink()
            print("✓ Cleared all cache")



