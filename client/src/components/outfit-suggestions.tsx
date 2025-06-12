import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Star, Save, Thermometer, Sun, Moon, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface ClothingItem {
  id: number;
  name: string;
  category: string;
  colors: string[];
  imageUrl: string;
}

interface OutfitSuggestion {
  name: string;
  occasion?: string;
  item_ids: number[];
  confidence: number;
  description: string;
  styling_tips?: string;
  weather?: string;
  personal_fit_analysis?: string;
  layering_strategy?: string;
  color_coordination?: string;
  occasion_appropriateness?: string;
  weather_adaptation?: string;
  accessories_rationale?: string;
  footwear_justification?: string;
  makeup_suggestion?: string;
  body_type_optimization?: string;
  age_appropriateness?: string;
  temperature_range?: string;
  formality_level?: string;
}

export function OutfitSuggestions() {
  const [occasion, setOccasion] = useState<string>('');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: suggestions = [], isLoading, refetch } = useQuery<OutfitSuggestion[]>({
    queryKey: ['/api/outfits/suggestions', occasion],
    queryFn: async () => {
      const url = occasion ? `/api/outfits/suggestions?occasion=${occasion}` : '/api/outfits/suggestions';
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) {
        if (response.status === 500) {
          // Handle case where user has no items
          return [];
        }
        throw new Error('Failed to fetch suggestions');
      }
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const { data: clothingItems = [] } = useQuery<ClothingItem[]>({
    queryKey: ['/api/clothing-items'],
  });

  const saveOutfitMutation = useMutation({
    mutationFn: (outfit: any) => apiRequest('POST', '/api/outfits', outfit),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/outfits'] });
      toast({
        title: "Outfit saved!",
        description: "Added to your saved outfits collection.",
      });
    },
    onError: () => {
      toast({
        title: "Save failed",
        description: "Failed to save outfit.",
        variant: "destructive",
      });
    },
  });

  const generateMutation = useMutation({
    mutationFn: () => refetch(),
    onSuccess: () => {
      toast({
        title: "New suggestions generated!",
        description: "Fresh outfit ideas based on your wardrobe.",
      });
    },
  });

  const getItemsByIds = (itemIds: number[]) => {
    return itemIds.map(id => clothingItems.find(item => item.id === id)).filter(Boolean) as ClothingItem[];
  };

  const getOccasionIcon = (occasion: string) => {
    switch (occasion) {
      case 'business':
      case 'formal':
        return <Thermometer className="w-4 h-4" />;
      case 'date_night':
        return <Moon className="w-4 h-4" />;
      default:
        return <Sun className="w-4 h-4" />;
    }
  };

  const getOccasionColor = (occasion: string) => {
    switch (occasion) {
      case 'business':
        return 'from-blue-100 to-white';
      case 'casual':
        return 'from-green-100 to-white';
      case 'date_night':
        return 'from-pink-100 to-white';
      case 'formal':
        return 'from-purple-100 to-white';
      default:
        return 'from-gray-100 to-white';
    }
  };

  if (clothingItems.length < 2) {
    return (
      <section className="py-16 bg-white" id="recommendations">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 font-serif mb-4">
              AI Outfit Suggestions
            </h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Upload at least 2 clothing items to get personalized outfit combinations.
            </p>
          </div>
          <Card className="p-12 text-center max-w-2xl mx-auto">
            <div className="text-gray-500">
              <h3 className="text-lg font-semibold mb-2">Ready for AI magic?</h3>
              <p>Add more items to your wardrobe to unlock personalized outfit suggestions powered by Google Gemini AI.</p>
              <Button className="mt-4" onClick={() => document.getElementById('upload')?.scrollIntoView({ behavior: 'smooth' })}>
                Upload Clothing Items
              </Button>
            </div>
          </Card>
        </div>
      </section>
    );
  }

  return (
    <section className="py-16 bg-white" id="recommendations">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 font-serif mb-4">
            AI Outfit Suggestions
          </h2>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Based on your body type, style preferences, and current wardrobe, here are personalized outfit combinations.
          </p>
        </div>

        <div className="flex justify-center items-center space-x-4 mb-8">
          <Select value={occasion} onValueChange={setOccasion}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Filter by occasion" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Occasions</SelectItem>
              <SelectItem value="business">Business</SelectItem>
              <SelectItem value="casual">Casual</SelectItem>
              <SelectItem value="date_night">Date Night</SelectItem>
              <SelectItem value="formal">Formal</SelectItem>
              <SelectItem value="sporty">Sporty</SelectItem>
            </SelectContent>
          </Select>
          
          <Button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            className="bg-gradient-to-r from-pink-500 to-indigo-500 hover:from-pink-600 hover:to-indigo-600"
          >
            {generateMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Generate New
          </Button>
        </div>

        {isLoading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {Array(6).fill(0).map((_, i) => (
              <Card key={i} className="p-6">
                <Skeleton className="h-6 w-32 mb-4" />
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <Skeleton className="w-full h-20 rounded-lg" />
                  <Skeleton className="w-full h-20 rounded-lg" />
                  <Skeleton className="w-full h-20 rounded-lg" />
                </div>
                <Skeleton className="h-16 w-full mb-4" />
                <Skeleton className="h-10 w-full" />
              </Card>
            ))}
          </div>
        ) : suggestions.length === 0 ? (
          <Card className="p-12 text-center max-w-2xl mx-auto">
            <div className="text-gray-500">
              <h3 className="text-lg font-semibold mb-2">No suggestions available</h3>
              <p>Try uploading more diverse clothing items or check back later for fresh AI-generated outfit ideas.</p>
            </div>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {suggestions.map((outfit, index) => {
              const outfitItems = getItemsByIds(outfit.item_ids);
              
              return (
                <Card
                  key={index}
                  className={`bg-gradient-to-br ${getOccasionColor(outfit.occasion || 'casual')} shadow-sm hover:shadow-lg transition-shadow`}
                >
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-gray-900">{outfit.name}</h3>
                      <div className="flex items-center space-x-1">
                        <Star className="w-4 h-4 text-yellow-400" />
                        <span className="text-sm text-gray-600">{outfit.confidence}% match</span>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      {outfitItems.map((item: any, itemIndex) => (
                        <div key={itemIndex} className="relative">
                          <img
                            src={item?.imageUrl || '/placeholder.png'}
                            alt={item?.name || 'Clothing item'}
                            className="w-full h-16 object-cover rounded-lg border border-gray-200"
                            title={item?.name}
                          />
                          <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-60 text-white text-xs p-1 rounded-b-lg truncate">
                            {item?.name}
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    <p className="text-sm text-gray-600 mb-4 line-clamp-3">
                      {outfit.description}
                    </p>
                    
                    {outfit.styling_tips && (
                      <p className="text-xs text-gray-500 mb-4 italic">
                        💡 {outfit.styling_tips}
                      </p>
                    )}
                    
                    <div className="flex justify-between items-center">
                      <div className="flex items-center space-x-2">
                        <Badge variant="outline" className="text-xs">
                          <span className="mr-1">{getOccasionIcon(outfit.occasion || 'casual')}</span>
                          {(outfit.occasion || 'casual').replace('_', ' ')}
                        </Badge>
                        {outfit.weather && (
                          <span className="text-xs text-gray-500">{outfit.weather}</span>
                        )}
                      </div>
                      <Button
                        size="sm"
                        onClick={() => saveOutfitMutation.mutate({
                          name: outfit.name,
                          itemIds: outfit.item_ids,
                          occasion: outfit.occasion,
                          aiConfidence: outfit.confidence,
                        })}
                        disabled={saveOutfitMutation.isPending}
                        className="bg-indigo-500 hover:bg-indigo-600"
                      >
                        {saveOutfitMutation.isPending ? (
                          <Loader2 className="w-3 h-3 animate-spin mr-1" />
                        ) : (
                          <Save className="w-3 h-3 mr-1" />
                        )}
                        Save
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
