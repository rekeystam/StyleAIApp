import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { User, Settings, MapPin, Ruler, Calendar, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface UserProfile {
  bodyType?: string;
  skinTone?: string;
  age?: number;
  height?: number;
  gender?: string;
  location?: string;
  preferences?: {
    favoriteColors?: string[];
    preferredStyles?: string[];
    avoidColors?: string[];
  };
}

export function UserProfile() {
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<UserProfile>({});
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: profile, isLoading } = useQuery<UserProfile>({
    queryKey: ['/api/user/profile'],
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const updateProfileMutation = useMutation({
    mutationFn: (data: UserProfile) => apiRequest('PUT', '/api/user/profile', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user/profile'] });
      setIsEditing(false);
      toast({
        title: "Profile updated",
        description: "Your style preferences have been saved successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Update failed",
        description: "Failed to update your profile. Please try again.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (profile && !isEditing) {
      setFormData(profile);
    }
  }, [profile, isEditing]);

  const handleSave = () => {
    updateProfileMutation.mutate(formData);
  };

  const handleCancel = () => {
    setFormData(profile || {});
    setIsEditing(false);
  };

  const handlePreferenceChange = (field: string, value: string[]) => {
    setFormData(prev => ({
      ...prev,
      preferences: {
        ...prev.preferences,
        [field]: value
      }
    }));
  };

  const addColorPreference = (field: 'favoriteColors' | 'avoidColors', color: string) => {
    if (!color.trim()) return;
    
    const currentColors = formData.preferences?.[field] || [];
    if (!currentColors.includes(color.toLowerCase())) {
      handlePreferenceChange(field, [...currentColors, color.toLowerCase()]);
    }
  };

  const removeColorPreference = (field: 'favoriteColors' | 'avoidColors', color: string) => {
    const currentColors = formData.preferences?.[field] || [];
    handlePreferenceChange(field, currentColors.filter(c => c !== color));
  };

  if (isLoading) {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="w-5 h-5" />
            Loading Profile...
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
            <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
            <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5" />
              Style Profile
            </CardTitle>
            {!isEditing ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-2"
              >
                <Settings className="w-4 h-4" />
                Edit Profile
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancel}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={updateProfileMutation.isPending}
                >
                  Save Changes
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Basic Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="age" className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Age
              </Label>
              {isEditing ? (
                <Input
                  id="age"
                  type="number"
                  value={formData.age || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, age: parseInt(e.target.value) || undefined }))}
                  placeholder="Enter your age"
                />
              ) : (
                <p className="text-sm text-gray-600 p-2 bg-gray-50 rounded">
                  {formData.age || 'Not specified'}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="height" className="flex items-center gap-2">
                <Ruler className="w-4 h-4" />
                Height (cm)
              </Label>
              {isEditing ? (
                <Input
                  id="height"
                  type="number"
                  value={formData.height || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, height: parseInt(e.target.value) || undefined }))}
                  placeholder="Enter height in cm"
                />
              ) : (
                <p className="text-sm text-gray-600 p-2 bg-gray-50 rounded">
                  {formData.height ? `${formData.height} cm` : 'Not specified'}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="bodyType">Body Type</Label>
              {isEditing ? (
                <Select value={formData.bodyType || ''} onValueChange={(value) => setFormData(prev => ({ ...prev, bodyType: value }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select body type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pear">Pear</SelectItem>
                    <SelectItem value="apple">Apple</SelectItem>
                    <SelectItem value="hourglass">Hourglass</SelectItem>
                    <SelectItem value="rectangle">Rectangle</SelectItem>
                    <SelectItem value="inverted_triangle">Inverted Triangle</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-gray-600 p-2 bg-gray-50 rounded capitalize">
                  {formData.bodyType?.replace('_', ' ') || 'Not specified'}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="skinTone" className="flex items-center gap-2">
                <Palette className="w-4 h-4" />
                Skin Tone
              </Label>
              {isEditing ? (
                <Select value={formData.skinTone || ''} onValueChange={(value) => setFormData(prev => ({ ...prev, skinTone: value }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select skin tone" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="warm">Warm</SelectItem>
                    <SelectItem value="cool">Cool</SelectItem>
                    <SelectItem value="neutral">Neutral</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-gray-600 p-2 bg-gray-50 rounded capitalize">
                  {formData.skinTone || 'Not specified'}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="gender">Gender</Label>
              {isEditing ? (
                <Select value={formData.gender || ''} onValueChange={(value) => setFormData(prev => ({ ...prev, gender: value }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select gender" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="non_binary">Non-binary</SelectItem>
                    <SelectItem value="prefer_not_to_say">Prefer not to say</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-gray-600 p-2 bg-gray-50 rounded capitalize">
                  {formData.gender?.replace('_', ' ') || 'Not specified'}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="location" className="flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                Location
              </Label>
              {isEditing ? (
                <Input
                  id="location"
                  value={formData.location || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                  placeholder="City, Country"
                />
              ) : (
                <p className="text-sm text-gray-600 p-2 bg-gray-50 rounded">
                  {formData.location || 'Not specified'}
                </p>
              )}
            </div>
          </div>

          {/* Style Preferences */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Style Preferences</h3>
            
            {/* Preferred Styles */}
            <div className="space-y-2">
              <Label>Preferred Styles</Label>
              {isEditing ? (
                <Select 
                  value=""
                  onValueChange={(value) => {
                    const currentStyles = formData.preferences?.preferredStyles || [];
                    if (!currentStyles.includes(value)) {
                      handlePreferenceChange('preferredStyles', [...currentStyles, value]);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Add preferred style" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="casual">Casual</SelectItem>
                    <SelectItem value="business_casual">Business Casual</SelectItem>
                    <SelectItem value="formal">Formal</SelectItem>
                    <SelectItem value="sporty">Sporty</SelectItem>
                    <SelectItem value="bohemian">Bohemian</SelectItem>
                    <SelectItem value="minimalist">Minimalist</SelectItem>
                    <SelectItem value="vintage">Vintage</SelectItem>
                  </SelectContent>
                </Select>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {(formData.preferences?.preferredStyles || []).map((style, index) => (
                  <Badge key={index} variant="secondary" className="capitalize">
                    {style.replace('_', ' ')}
                    {isEditing && (
                      <button
                        className="ml-2 text-red-500 hover:text-red-700"
                        onClick={() => {
                          const styles = formData.preferences?.preferredStyles || [];
                          handlePreferenceChange('preferredStyles', styles.filter(s => s !== style));
                        }}
                      >
                        ×
                      </button>
                    )}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Favorite Colors */}
            <div className="space-y-2">
              <Label>Favorite Colors</Label>
              {isEditing && (
                <div className="flex gap-2">
                  <Input
                    placeholder="Add favorite color"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        addColorPreference('favoriteColors', e.currentTarget.value);
                        e.currentTarget.value = '';
                      }
                    }}
                  />
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {(formData.preferences?.favoriteColors || []).map((color, index) => (
                  <Badge key={index} variant="outline" className="capitalize">
                    {color}
                    {isEditing && (
                      <button
                        className="ml-2 text-red-500 hover:text-red-700"
                        onClick={() => removeColorPreference('favoriteColors', color)}
                      >
                        ×
                      </button>
                    )}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Colors to Avoid */}
            <div className="space-y-2">
              <Label>Colors to Avoid</Label>
              {isEditing && (
                <div className="flex gap-2">
                  <Input
                    placeholder="Add color to avoid"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        addColorPreference('avoidColors', e.currentTarget.value);
                        e.currentTarget.value = '';
                      }
                    }}
                  />
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {(formData.preferences?.avoidColors || []).map((color, index) => (
                  <Badge key={index} variant="destructive" className="capitalize">
                    {color}
                    {isEditing && (
                      <button
                        className="ml-2 text-white hover:text-gray-200"
                        onClick={() => removeColorPreference('avoidColors', color)}
                      >
                        ×
                      </button>
                    )}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          {!profile?.bodyType && !isEditing && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>Complete your profile</strong> to get personalized outfit recommendations based on your body type, skin tone, and style preferences.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}