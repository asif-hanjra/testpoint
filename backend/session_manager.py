import json
import os
from pathlib import Path
from typing import Dict, Optional, List

class SessionManager:
    """Manages session persistence for resume functionality"""
    
    def __init__(self, session_dir: str = ".sessions"):
        self.session_dir = Path(session_dir)
        self.session_dir.mkdir(exist_ok=True)
    
    def _get_session_path(self, subject: str) -> Path:
        """Get session file path for subject"""
        return self.session_dir / f"{subject}_session.json"
    
    def save_session(self, subject: str, session_data: Dict):
        """Save session data to file"""
        session_path = self._get_session_path(subject)
        
        try:
            with open(session_path, 'w', encoding='utf-8') as f:
                json.dump(session_data, f, indent=2)
            print(f"✓ Session saved for {subject}")
        except Exception as e:
            print(f"Error saving session: {e}")
    
    def load_session(self, subject: str) -> Optional[Dict]:
        """Load session data from file"""
        session_path = self._get_session_path(subject)
        
        if not session_path.exists():
            return None
        
        try:
            import time
            start_time = time.time()
            with open(session_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            load_time = time.time() - start_time
            print(f"✓ Session loaded for {subject} in {load_time:.2f}s")
            return data
        except Exception as e:
            print(f"Error loading session: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def load_session_metadata_only(self, subject: str) -> Optional[Dict]:
        """Load only metadata from session file (faster, doesn't return groups)"""
        session_path = self._get_session_path(subject)
        
        if not session_path.exists():
            return None
        
        try:
            # Still need to parse JSON, but we only return metadata fields
            with open(session_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                # Return only metadata (exclude groups to avoid large data)
                return {
                    "total_files": data.get("total_files", 0),
                    "non_duplicate_count": data.get("non_duplicate_count", 0),
                    "files_in_groups": data.get("files_in_groups", 0),
                    "completed_groups": data.get("completed_groups", []),
                    "files_saved": data.get("files_saved", False),
                    "has_groups_pairwise": "groups_pairwise" in data or "groups" in data
                }
        except Exception as e:
            print(f"Error loading session metadata: {e}")
            return None
    
    def clear_session(self, subject: str):
        """Clear session data for subject"""
        session_path = self._get_session_path(subject)
        
        if session_path.exists():
            try:
                session_path.unlink()
                print(f"✓ Session cleared for {subject}")
            except Exception as e:
                print(f"Error clearing session: {e}")
    
    def session_exists(self, subject: str) -> bool:
        """Check if session exists for subject"""
        return self._get_session_path(subject).exists()
    
    def get_completed_groups(self, subject: str) -> List[int]:
        """Get list of completed group indices"""
        session = self.load_session(subject)
        if session:
            return session.get("completed_groups", [])
        return []
    
    def mark_group_completed(self, subject: str, group_index: int):
        """Mark a group as completed"""
        session = self.load_session(subject)
        if session:
            if "completed_groups" not in session:
                session["completed_groups"] = []
            if group_index not in session["completed_groups"]:
                session["completed_groups"].append(group_index)
            self.save_session(subject, session)

