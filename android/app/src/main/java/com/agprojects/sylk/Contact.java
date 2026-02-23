package com.agprojects.sylk;

import java.util.List;

public class Contact {

    private String displayName;
    private List<String> tags;

    public Contact(String displayName, List<String> tags) {
        this.displayName = displayName;
        this.tags = tags;
    }

    public String getDisplayName() {
        return displayName;
    }

    public List<String> getTags() {
        return tags;
    }

    public boolean hasTags() {
        return tags != null && !tags.isEmpty();
    }
}
