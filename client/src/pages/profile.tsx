import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { updateUserProfileSchema } from "@shared/schema";
import type { User, UpdateUserProfile } from "@shared/schema";
import { Navigation } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { User as UserIcon, Save, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

const bodyTypes = [
  { value: "pear", label: "Pear" },
  { value: "apple", label: "Apple" },
  { value: "hourglass", label: "Hourglass" },
  { value: "rectangle", label: "Rectangle" },
  { value: "inverted_triangle", label: "Inverted Triangle" },
];

const skinTones = [
  { value: "cool", label: "Cool" },
  { value: "warm", label: "Warm" },
  { value: "neutral", label: "Neutral" },
];

const genderOptions = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "non_binary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

export default function Profile() {
  const { toast } = useToast();
  const [selectedPreferences, setSelectedPreferences] = useState<string[]>([]);

  const { data: user, isLoading } = useQuery<User>({
    queryKey: ["/api/user/profile"],
  });

  const form = useForm<UpdateUserProfile>({
    resolver: zodResolver(updateUserProfileSchema),
    defaultValues: {
      bodyType: "",
      skinTone: "",
      age: 25,
      height: 170,
      gender: "",
      location: "",
      preferences: "",
    },
  });

  // Update form when user data loads
  React.useEffect(() => {
    if (user) {
      form.reset({
        bodyType: user.bodyType || "",
        skinTone: user.skinTone || "",
        age: user.age || 25,
        height: user.height || 170,
        gender: user.gender || "",
        location: user.location || "",
        preferences: user.preferences || "",
      });

      // Parse preferences if they exist
      if (user.preferences) {
        try {
          let prefs;
          if (typeof user.preferences === 'string') {
            prefs = JSON.parse(user.preferences);
          } else if (typeof user.preferences === 'object' && user.preferences !== null) {
            prefs = user.preferences;
          }
          
          if (prefs && Array.isArray(prefs.styles)) {
            setSelectedPreferences(prefs.styles);
          } else {
            setSelectedPreferences([]);
          }
        } catch (e) {
          console.error("Error parsing preferences:", e);
          setSelectedPreferences([]);
        }
      } else {
        setSelectedPreferences([]);
      }
    }
  }, [user, form]);

  const updateProfileMutation = useMutation({
    mutationFn: (data: UpdateUserProfile) => 
      apiRequest("PUT", "/api/user/profile", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
      toast({
        title: "Profile Updated",
        description: "Your profile has been successfully updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update profile. Please try again.",
        variant: "destructive",
      });
    },
  });

  const stylePreferences = [
    "casual", "business", "formal", "boho", "minimalist", "vintage", 
    "sporty", "edgy", "romantic", "classic", "trendy", "artistic"
  ];

  const togglePreference = (preference: string) => {
    setSelectedPreferences(prev => 
      prev.includes(preference)
        ? prev.filter(p => p !== preference)
        : [...prev, preference]
    );
  };

  const onSubmit = (data: UpdateUserProfile) => {
    const preferences = {
      styles: selectedPreferences,
    };
    
    updateProfileMutation.mutate({
      ...data,
      preferences: JSON.stringify(preferences),
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-gradient-to-br from-pink-500 to-indigo-500 rounded-xl flex items-center justify-center">
                <UserIcon className="text-white w-6 h-6" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900 font-serif">Profile Settings</h1>
                <p className="text-gray-600">Personalize your style recommendations</p>
              </div>
            </div>
            <Button 
              variant="outline" 
              onClick={() => window.location.href = '/'}
              className="flex items-center gap-2"
            >
              ← Back to Wardrobe
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Personal Information</CardTitle>
            <CardDescription>
              Help us provide better outfit recommendations by sharing some details about yourself.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-1 gap-6">
                  <FormField
                    control={form.control}
                    name="location"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Location</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="e.g., New York, NY" 
                            {...field}
                            value={field.value || ""}
                          />
                        </FormControl>
                        <FormDescription>
                          Helps us provide weather-appropriate recommendations
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="age"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Age</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            placeholder="25" 
                            value={field.value || ""}
                            onChange={(e) => field.onChange(parseInt(e.target.value) || null)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="height"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Height (cm)</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            placeholder="170" 
                            value={field.value || ""}
                            onChange={(e) => field.onChange(parseInt(e.target.value) || null)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <FormField
                    control={form.control}
                    name="bodyType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Body Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value ?? ""}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select body type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {bodyTypes.map((type) => (
                              <SelectItem key={type.value} value={type.value}>
                                {type.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          Helps us suggest flattering silhouettes
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="skinTone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Skin Tone</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value ?? ""}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select skin tone" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {skinTones.map((tone) => (
                              <SelectItem key={tone.value} value={tone.value}>
                                {tone.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          Helps us recommend complementary colors
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="gender"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Gender</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value ?? ""}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select gender" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {genderOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div>
                  <FormLabel>Style Preferences</FormLabel>
                  <FormDescription className="mb-3">
                    Select the styles you like. This helps us recommend outfits that match your taste.
                  </FormDescription>
                  <div className="flex flex-wrap gap-2">
                    {stylePreferences.map((style) => (
                      <Badge
                        key={style}
                        variant={selectedPreferences.includes(style) ? "default" : "secondary"}
                        className={`cursor-pointer transition-colors ${
                          selectedPreferences.includes(style)
                            ? "bg-indigo-500 hover:bg-indigo-600"
                            : "hover:bg-gray-200"
                        }`}
                        onClick={() => togglePreference(style)}
                      >
                        {style}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="pt-4">
                  <Button
                    type="submit"
                    disabled={updateProfileMutation.isPending}
                    className="bg-indigo-500 hover:bg-indigo-600 text-white"
                  >
                    {updateProfileMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Updating...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Save Profile
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}