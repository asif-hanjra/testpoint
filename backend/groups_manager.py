import json
from pathlib import Path
from typing import Dict, List, Optional

class GroupsManager:
    """Manages groups storage separately from session data"""
    
    def __init__(self, groups_dir: str = ".groups"):
        self.groups_dir = Path(groups_dir)
        self.groups_dir.mkdir(exist_ok=True)
    
    def _get_groups_path(self, subject: str) -> Path:
        """Get groups file path for subject"""
        return self.groups_dir / f"{subject}_groups.json"
    
    def save_groups(self, subject: str, groups_pairwise: List[Dict]):
        """Save groups to separate file"""
        groups_path = self._get_groups_path(subject)
        
        try:
            groups_data = {
                "groups_pairwise": groups_pairwise,
                "pairwise_count": len(groups_pairwise)
            }
            with open(groups_path, 'w', encoding='utf-8') as f:
                json.dump(groups_data, f, indent=2)
            print(f"✓ Saved groups for {subject} ({len(groups_pairwise)} pairwise)")
        except Exception as e:
            print(f"Error saving groups: {e}")
            import traceback
            traceback.print_exc()
    
    def load_groups(self, subject: str) -> Optional[Dict]:
        """Load groups from separate file"""
        groups_path = self._get_groups_path(subject)
        
        if not groups_path.exists():
            return None
        
        try:
            with open(groups_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            print(f"✓ Loaded groups for {subject}")
            return data
        except Exception as e:
            print(f"Error loading groups: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def groups_exist(self, subject: str) -> bool:
        """Check if groups file exists"""
        return self._get_groups_path(subject).exists()
    
    def clear_groups(self, subject: Optional[str] = None):
        """Clear groups for specific subject or all"""
        if subject:
            groups_path = self._get_groups_path(subject)
            if groups_path.exists():
                groups_path.unlink()
                print(f"✓ Cleared groups for {subject}")
        else:
            for groups_file in self.groups_dir.glob("*_groups.json"):
                groups_file.unlink()
            print("✓ Cleared all groups")



